package provider

import (
	"context"
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

type appModel struct {
	ID        types.String `tfsdk:"id"`
	Name      types.String `tfsdk:"name"`
	RepoURL   types.String `tfsdk:"repo_url"`
	Branch    types.String `tfsdk:"branch"`
	Port      types.Int64  `tfsdk:"port"`
	Size      types.String `tfsdk:"size"`
	Instances types.Int64  `tfsdk:"instances"`
	Env       types.Map    `tfsdk:"env"`
	GitToken  types.String `tfsdk:"git_token"`
	URL       types.String `tfsdk:"url"`
	Status    types.String `tfsdk:"status"`
}

type appResource struct{ c *client.Client }

func NewAppResource() resource.Resource { return &appResource{} }

func (r *appResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_app"
}

func (r *appResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	forceNew := []planmodifier.String{stringplanmodifier.RequiresReplace()}
	computed := []planmodifier.String{stringplanmodifier.UseStateForUnknown()}
	res.Schema = schema.Schema{
		Description: "An App Platform app: a repository built and run in containers on shared hosts, reachable at url with TLS. Changing branch, port, size, instances or env deploys again.",
		Attributes: map[string]schema.Attribute{
			"id":        schema.StringAttribute{Computed: true, PlanModifiers: computed},
			"name":      schema.StringAttribute{Required: true, Description: "Hostname label, unique across the platform", PlanModifiers: forceNew},
			"repo_url":  schema.StringAttribute{Required: true, PlanModifiers: forceNew},
			"branch":    schema.StringAttribute{Optional: true, Computed: true},
			"port":      schema.Int64Attribute{Optional: true, Computed: true},
			"size":      schema.StringAttribute{Optional: true, Computed: true, Description: "app-xs, app-s, app-m or app-l"},
			"instances": schema.Int64Attribute{Optional: true, Computed: true},
			"env":       schema.MapAttribute{ElementType: types.StringType, Optional: true, Computed: true, Sensitive: true},
			"git_token": schema.StringAttribute{Optional: true, Sensitive: true, Description: "Token for a private repository"},
			"url":       schema.StringAttribute{Computed: true, PlanModifiers: computed},
			"status":    schema.StringAttribute{Computed: true},
		},
	}
}

func (r *appResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func (r *appResource) apply(m *appModel, a *client.PlatformApp) {
	m.ID, m.Name, m.RepoURL, m.Branch, m.Port, m.Size, m.Instances, m.URL, m.Status = types.StringValue(a.ID), types.StringValue(a.Name), types.StringValue(a.RepoURL), types.StringValue(a.Branch), types.Int64Value(int64(a.Port)), types.StringValue(a.Size.ID), types.Int64Value(int64(a.Instances)), types.StringValue(a.URL), types.StringValue(a.Status)
	vals := map[string]string{}
	for k, v := range a.Env {
		vals[k] = v
	}
	env, _ := types.MapValueFrom(context.Background(), types.StringType, vals)
	m.Env = env
	if m.GitToken.IsUnknown() {
		m.GitToken = types.StringNull()
	}
}

func (r *appResource) body(ctx context.Context, m *appModel) map[string]interface{} {
	body := map[string]interface{}{}
	setIf(body, "branch", m.Branch)
	setIf(body, "size", m.Size)
	setIf(body, "gitToken", m.GitToken)
	if !m.Port.IsNull() && !m.Port.IsUnknown() {
		body["port"] = m.Port.ValueInt64()
	}
	if !m.Instances.IsNull() && !m.Instances.IsUnknown() {
		body["instances"] = m.Instances.ValueInt64()
	}
	if !m.Env.IsNull() && !m.Env.IsUnknown() {
		env := map[string]string{}
		_ = m.Env.ElementsAs(ctx, &env, false)
		body["env"] = env
	}
	return body
}

func (r *appResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m appModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	body := r.body(ctx, &m)
	body["name"] = m.Name.ValueString()
	body["repoUrl"] = m.RepoURL.ValueString()
	var a client.PlatformApp
	if err := r.c.Do(ctx, http.MethodPost, "/v1/app-platform/apps", body, &a); err != nil {
		res.Diagnostics.AddError("Creating app", err.Error())
		return
	}
	settled, err := r.c.WaitApp(ctx, a.ID, 30*time.Minute)
	if settled != nil {
		r.apply(&m, settled)
		res.Diagnostics.Append(res.State.Set(ctx, &m)...)
	}
	if err != nil {
		res.Diagnostics.AddError("Waiting for app", err.Error())
	}
}

func (r *appResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m appModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var a client.PlatformApp
	if err := r.c.Do(ctx, http.MethodGet, "/v1/app-platform/apps/"+m.ID.ValueString(), nil, &a); err != nil {
		if client.IsNotFound(err) {
			res.State.RemoveResource(ctx)
			return
		}
		res.Diagnostics.AddError("Reading app", err.Error())
		return
	}
	if a.Status == "deleted" || a.Status == "deleting" {
		res.State.RemoveResource(ctx)
		return
	}
	r.apply(&m, &a)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *appResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var plan, state appModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	res.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if res.Diagnostics.HasError() {
		return
	}
	if err := r.c.Do(ctx, http.MethodPatch, "/v1/app-platform/apps/"+state.ID.ValueString(), r.body(ctx, &plan), nil); err != nil {
		res.Diagnostics.AddError("Updating app", err.Error())
		return
	}
	a, err := r.c.WaitApp(ctx, state.ID.ValueString(), 30*time.Minute)
	if err != nil {
		res.Diagnostics.AddError("Waiting for app", err.Error())
		return
	}
	plan.ID = state.ID
	r.apply(&plan, a)
	res.Diagnostics.Append(res.State.Set(ctx, &plan)...)
}

func (r *appResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m appModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/app-platform/apps/"+m.ID.ValueString(), nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Deleting app", err.Error())
	}
}

func (r *appResource) ImportState(ctx context.Context, req resource.ImportStateRequest, res *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, res)
}
