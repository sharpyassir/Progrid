package provider

import (
	"context"
	"net/http"
	"time"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/int64planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/prgd/terraform-provider-prgd/internal/client"
)

// databaseResource manages a managed database cluster. Trusted sources and the backup hour
// update in place; name, engine, size and nodes replace the cluster.
type databaseResource struct{ c *client.Client }

type databaseModel struct {
	ID             types.String `tfsdk:"id"`
	Name           types.String `tfsdk:"name"`
	Engine         types.String `tfsdk:"engine"`
	Version        types.String `tfsdk:"version"`
	Size           types.String `tfsdk:"size"`
	Nodes          types.Int64  `tfsdk:"nodes"`
	Region         types.String `tfsdk:"region"`
	TrustedSources types.List   `tfsdk:"trusted_sources"`
	BackupHourUTC  types.Int64  `tfsdk:"backup_hour_utc"`
	Host           types.String `tfsdk:"host"`
	PrivateHost    types.String `tfsdk:"private_host"`
	Port           types.Int64  `tfsdk:"port"`
	User           types.String `tfsdk:"user"`
	Password       types.String `tfsdk:"password"`
	Database       types.String `tfsdk:"database"`
	URI            types.String `tfsdk:"uri"`
	Status         types.String `tfsdk:"status"`
}

func NewDatabaseResource() resource.Resource { return &databaseResource{} }

func (r *databaseResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_database"
}

func (r *databaseResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	forceNew := []planmodifier.String{stringplanmodifier.RequiresReplace()}
	computed := []planmodifier.String{stringplanmodifier.UseStateForUnknown()}
	res.Schema = schema.Schema{
		Description: "A managed database cluster (PostgreSQL first): 1 node, or 3 with automatic failover. Connection details are computed; password and uri are sensitive.",
		Attributes: map[string]schema.Attribute{
			"id":              schema.StringAttribute{Computed: true, PlanModifiers: computed},
			"name":            schema.StringAttribute{Required: true, PlanModifiers: forceNew},
			"engine":          schema.StringAttribute{Optional: true, Computed: true, Description: "postgres, valkey or mysql", PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace(), stringplanmodifier.UseStateForUnknown()}},
			"version":         schema.StringAttribute{Optional: true, Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace(), stringplanmodifier.UseStateForUnknown()}},
			"size":            schema.StringAttribute{Required: true, Description: "Server size id with at least 1 GB of memory", PlanModifiers: forceNew},
			"nodes":           schema.Int64Attribute{Optional: true, Computed: true, Description: "1 or 3", PlanModifiers: []planmodifier.Int64{int64planmodifier.RequiresReplace(), int64planmodifier.UseStateForUnknown()}},
			"region":          schema.StringAttribute{Optional: true, Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace(), stringplanmodifier.UseStateForUnknown()}},
			"trusted_sources": schema.ListAttribute{ElementType: types.StringType, Optional: true, Computed: true},
			"backup_hour_utc": schema.Int64Attribute{Optional: true, Computed: true},
			"host":            schema.StringAttribute{Computed: true, PlanModifiers: computed},
			"private_host":    schema.StringAttribute{Computed: true},
			"port":            schema.Int64Attribute{Computed: true},
			"user":            schema.StringAttribute{Computed: true},
			"password":        schema.StringAttribute{Computed: true, Sensitive: true},
			"database":        schema.StringAttribute{Computed: true},
			"uri":             schema.StringAttribute{Computed: true, Sensitive: true},
			"status":          schema.StringAttribute{Computed: true},
		},
	}
}

func (r *databaseResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func (r *databaseResource) apply(m *databaseModel, d *client.Database) {
	m.ID, m.Name, m.Engine, m.Version, m.Size, m.Nodes, m.Region, m.Status = types.StringValue(d.ID), types.StringValue(d.Name), types.StringValue(d.Engine), types.StringValue(d.Version), types.StringValue(d.Size.ID), types.Int64Value(int64(d.Nodes)), types.StringValue(d.RegionID), types.StringValue(d.Status)
	m.TrustedSources, m.BackupHourUTC = stringList(d.TrustedSources), types.Int64Value(int64(d.BackupHourUTC))
	m.Port, m.User, m.Database = types.Int64Value(int64(d.Connection.Port)), types.StringValue(d.Connection.User), types.StringValue(d.Connection.Database)
	m.Password, m.URI = types.StringValue(d.Connection.Password), types.StringValue(str(d.Connection.URI))
	m.Host, m.PrivateHost = types.StringValue(str(d.Connection.Host)), types.StringValue(str(d.Connection.PrivateHost))
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (r *databaseResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m databaseModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	body := map[string]interface{}{"name": m.Name.ValueString(), "size": m.Size.ValueString(), "engine": "postgres"}
	for k, v := range map[string]types.String{"engine": m.Engine, "version": m.Version, "region": m.Region} {
		if !v.IsNull() && !v.IsUnknown() && v.ValueString() != "" {
			body[k] = v.ValueString()
		}
	}
	if !m.Nodes.IsNull() && !m.Nodes.IsUnknown() {
		body["nodes"] = m.Nodes.ValueInt64()
	}
	if !m.BackupHourUTC.IsNull() && !m.BackupHourUTC.IsUnknown() {
		body["backupHourUtc"] = m.BackupHourUTC.ValueInt64()
	}
	if !m.TrustedSources.IsNull() && !m.TrustedSources.IsUnknown() {
		body["trustedSources"] = strings(ctx, m.TrustedSources)
	}
	var d client.Database
	if err := r.c.Do(ctx, http.MethodPost, "/v1/databases", body, &d); err != nil {
		res.Diagnostics.AddError("Creating database", err.Error())
		return
	}
	settled, err := r.c.WaitDatabase(ctx, d.ID, 30*time.Minute)
	if settled != nil {
		r.apply(&m, settled)
		res.Diagnostics.Append(res.State.Set(ctx, &m)...)
	}
	if err != nil {
		res.Diagnostics.AddError("Waiting for database", err.Error())
	}
}

func (r *databaseResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m databaseModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var d client.Database
	if err := r.c.Do(ctx, http.MethodGet, "/v1/databases/"+m.ID.ValueString(), nil, &d); err != nil {
		if client.IsNotFound(err) {
			res.State.RemoveResource(ctx)
			return
		}
		res.Diagnostics.AddError("Reading database", err.Error())
		return
	}
	if d.Status == "deleted" || d.Status == "deleting" {
		res.State.RemoveResource(ctx)
		return
	}
	r.apply(&m, &d)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *databaseResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var plan, state databaseModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	res.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if res.Diagnostics.HasError() {
		return
	}
	body := map[string]interface{}{}
	if !plan.TrustedSources.IsNull() && !plan.TrustedSources.IsUnknown() {
		body["trustedSources"] = strings(ctx, plan.TrustedSources)
	}
	if !plan.BackupHourUTC.IsNull() && !plan.BackupHourUTC.IsUnknown() {
		body["backupHourUtc"] = plan.BackupHourUTC.ValueInt64()
	}
	if err := r.c.Do(ctx, http.MethodPatch, "/v1/databases/"+state.ID.ValueString(), body, nil); err != nil {
		res.Diagnostics.AddError("Updating database", err.Error())
		return
	}
	d, err := r.c.WaitDatabase(ctx, state.ID.ValueString(), 30*time.Minute)
	if err != nil {
		res.Diagnostics.AddError("Waiting for database", err.Error())
		return
	}
	r.apply(&plan, d)
	res.Diagnostics.Append(res.State.Set(ctx, &plan)...)
}

func (r *databaseResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m databaseModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/databases/"+m.ID.ValueString(), nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Deleting database", err.Error())
	}
}

func (r *databaseResource) ImportState(ctx context.Context, req resource.ImportStateRequest, res *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, res)
}
