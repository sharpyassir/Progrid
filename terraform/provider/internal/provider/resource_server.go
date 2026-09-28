package provider

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/prgd/terraform-provider-prgd/internal/client"
)

type serverResource struct{ c *client.Client }

type serverModel struct {
	ID        types.String `tfsdk:"id"`
	Name      types.String `tfsdk:"name"`
	Size      types.String `tfsdk:"size"`
	Image     types.String `tfsdk:"image"`
	Region    types.String `tfsdk:"region"`
	Project   types.String `tfsdk:"project"`
	SshKeys   types.List   `tfsdk:"ssh_keys"`
	Firewalls types.List   `tfsdk:"firewalls"`
	Tags      types.List   `tfsdk:"tags"`
	UserData  types.String `tfsdk:"user_data"`
	Backups   types.Bool   `tfsdk:"backups"`
	Managed   types.Bool   `tfsdk:"managed"`
	Status    types.String `tfsdk:"status"`
	IPv4      types.String `tfsdk:"ipv4_address"`
	PrivateIP types.String `tfsdk:"private_ip"`
}

func NewServerResource() resource.Resource { return &serverResource{} }

func (r *serverResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_server"
}

func (r *serverResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	forceNew := []planmodifier.String{stringplanmodifier.RequiresReplace()}
	res.Schema = schema.Schema{
		Description: "A prgd server. Changing size resizes in place (the server restarts); changing image, region, project, user_data or name replaces it.",
		Attributes: map[string]schema.Attribute{
			"id":           schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"name":         schema.StringAttribute{Required: true, PlanModifiers: forceNew, Description: "Hostname label."},
			"size":         schema.StringAttribute{Required: true, Description: "Size id, for example s-1vcpu-1gb. See data.prgd_sizes."},
			"image":        schema.StringAttribute{Required: true, PlanModifiers: forceNew, Description: "Image id or marketplace app slug."},
			"region":       schema.StringAttribute{Optional: true, Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplaceIfConfigured(), stringplanmodifier.UseStateForUnknown()}},
			"project":      schema.StringAttribute{Optional: true, PlanModifiers: forceNew, Description: "Project id or slug. Defaults to the token's project."},
			"ssh_keys":     schema.ListAttribute{ElementType: types.StringType, Optional: true, Description: "SSH key ids injected at creation."},
			"firewalls":    schema.ListAttribute{ElementType: types.StringType, Optional: true, Description: "Firewall ids to attach; managed on update."},
			"tags":         schema.ListAttribute{ElementType: types.StringType, Optional: true},
			"user_data":    schema.StringAttribute{Optional: true, PlanModifiers: forceNew, Description: "cloud-init user data."},
			"backups":      schema.BoolAttribute{Optional: true},
			"managed":      schema.BoolAttribute{Optional: true, Description: "Managed tier: patched, hardened and watched, daily backups included."},
			"status":       schema.StringAttribute{Computed: true},
			"ipv4_address": schema.StringAttribute{Computed: true},
			"private_ip":   schema.StringAttribute{Computed: true},
		},
	}
}

func (r *serverResource) Configure(_ context.Context, req resource.ConfigureRequest, res *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	r.c = clientFrom(req.ProviderData)
}

func (r *serverResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m serverModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	body := map[string]interface{}{"name": m.Name.ValueString(), "size": m.Size.ValueString(), "image": m.Image.ValueString()}
	setIf(body, "region", m.Region)
	setIf(body, "project", m.Project)
	setIf(body, "userData", m.UserData)
	if !m.Backups.IsNull() {
		body["backups"] = m.Backups.ValueBool()
	}
	if !m.Managed.IsNull() {
		body["managed"] = m.Managed.ValueBool()
	}
	for k, l := range map[string]types.List{"sshKeys": m.SshKeys, "firewalls": m.Firewalls, "tags": m.Tags} {
		if v := strings(ctx, l); v != nil {
			body[k] = v
		}
	}
	var s client.Server
	if err := r.c.Do(ctx, http.MethodPost, "/v1/servers", body, &s); err != nil {
		res.Diagnostics.AddError("Creating server", err.Error())
		return
	}
	m.ID = types.StringValue(s.ID)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...) // persist the id before waiting so a failure can be retried or destroyed
	settled, err := r.c.WaitServer(ctx, s.ID, 10*time.Minute)
	if err != nil {
		res.Diagnostics.AddError("Waiting for server", err.Error())
		return
	}
	fill(&m, settled)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *serverResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m serverModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var s client.Server
	err := r.c.Do(ctx, http.MethodGet, "/v1/servers/"+m.ID.ValueString(), nil, &s)
	if client.IsNotFound(err) {
		res.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		res.Diagnostics.AddError("Reading server", err.Error())
		return
	}
	fill(&m, &s)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *serverResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var plan, state serverModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	res.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if res.Diagnostics.HasError() {
		return
	}
	id := state.ID.ValueString()
	if plan.Size.ValueString() != state.Size.ValueString() {
		if err := r.c.Do(ctx, http.MethodPost, "/v1/servers/"+id+"/actions", map[string]interface{}{"type": "resize", "size": plan.Size.ValueString()}, nil); err != nil {
			res.Diagnostics.AddError("Resizing server", err.Error())
			return
		}
		if _, err := r.c.WaitServer(ctx, id, 10*time.Minute); err != nil {
			res.Diagnostics.AddError("Waiting for resize", err.Error())
			return
		}
	}
	want, have := set(strings(ctx, plan.Firewalls)), set(strings(ctx, state.Firewalls))
	for fw := range have {
		if !want[fw] {
			if err := r.c.Do(ctx, http.MethodDelete, "/v1/firewalls/"+fw+"/servers/"+id, nil, nil); err != nil && !client.IsNotFound(err) {
				res.Diagnostics.AddError("Detaching firewall "+fw, err.Error())
				return
			}
		}
	}
	for fw := range want {
		if !have[fw] {
			if err := r.c.Do(ctx, http.MethodPost, "/v1/firewalls/"+fw+"/servers", map[string]string{"serverId": id}, nil); err != nil {
				res.Diagnostics.AddError("Attaching firewall "+fw, err.Error())
				return
			}
		}
	}
	patch := map[string]interface{}{}
	if !plan.Backups.IsNull() && plan.Backups.ValueBool() != state.Backups.ValueBool() {
		patch["backups"] = plan.Backups.ValueBool()
	}
	if !plan.Managed.IsNull() && plan.Managed.ValueBool() != state.Managed.ValueBool() {
		patch["managed"] = plan.Managed.ValueBool()
	}
	if plan.Name.ValueString() != state.Name.ValueString() {
		patch["name"] = plan.Name.ValueString()
	}
	if len(patch) > 0 {
		if err := r.c.Do(ctx, http.MethodPatch, "/v1/servers/"+id, patch, nil); err != nil {
			res.Diagnostics.AddError("Updating server", err.Error())
			return
		}
	}
	var s client.Server
	if err := r.c.Do(ctx, http.MethodGet, "/v1/servers/"+id, nil, &s); err != nil {
		res.Diagnostics.AddError("Reading server", err.Error())
		return
	}
	plan.ID = state.ID
	fill(&plan, &s)
	res.Diagnostics.Append(res.State.Set(ctx, &plan)...)
}

func (r *serverResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m serverModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	id := m.ID.ValueString()
	err := r.c.Do(ctx, http.MethodDelete, "/v1/servers/"+id, nil, nil)
	if client.IsNotFound(err) {
		return
	}
	if err != nil {
		res.Diagnostics.AddError("Deleting server", err.Error()+"\nIf the token requires approval for deletes, approve it in the console and run apply again.")
		return
	}
	if err := r.c.WaitGone(ctx, id, 5*time.Minute); err != nil {
		res.Diagnostics.AddError("Waiting for deletion", err.Error())
	}
}

func (r *serverResource) ImportState(ctx context.Context, req resource.ImportStateRequest, res *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, res)
}

// ---- helpers ----

func fill(m *serverModel, s *client.Server) {
	m.ID = types.StringValue(s.ID)
	m.Name = types.StringValue(s.Name)
	m.Size = types.StringValue(s.Size.ID)
	m.Image = types.StringValue(s.Image.ID)
	m.Region = types.StringValue(s.Region.ID)
	m.Status = types.StringValue(s.Status)
	m.Backups = types.BoolValue(s.BackupsEnabled)
	m.Managed = types.BoolValue(s.Managed)
	if len(s.Networks.V4) > 0 {
		m.IPv4 = types.StringValue(s.Networks.V4[0].IPAddress)
	} else {
		m.IPv4 = types.StringNull()
	}
	if len(s.Networks.Private) > 0 {
		m.PrivateIP = types.StringValue(s.Networks.Private[0].IPAddress)
	} else {
		m.PrivateIP = types.StringNull()
	}
	if !m.Firewalls.IsNull() || len(s.Firewalls) > 0 {
		m.Firewalls = stringList(s.Firewalls)
	}
	if !m.Tags.IsNull() || len(s.Tags) > 0 {
		m.Tags = stringList(s.Tags)
	}
}

func setIf(body map[string]interface{}, key string, v types.String) {
	if !v.IsNull() && !v.IsUnknown() && v.ValueString() != "" {
		body[key] = v.ValueString()
	}
}

func strings(ctx context.Context, l types.List) []string {
	if l.IsNull() || l.IsUnknown() {
		return nil
	}
	var out []string
	_ = l.ElementsAs(ctx, &out, false)
	return out
}

func stringList(v []string) types.List {
	vals := make([]types.String, len(v))
	for i, s := range v {
		vals[i] = types.StringValue(s)
	}
	l, _ := types.ListValueFrom(context.Background(), types.StringType, vals)
	return l
}

func set(v []string) map[string]bool {
	m := map[string]bool{}
	for _, s := range v {
		m[s] = true
	}
	return m
}

var _ = fmt.Sprintf
