package provider

import (
	"context"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/prgd/terraform-provider-prgd/internal/client"
)

type sshKeyResource struct{ c *client.Client }

type sshKeyModel struct {
	ID          types.String `tfsdk:"id"`
	Name        types.String `tfsdk:"name"`
	PublicKey   types.String `tfsdk:"public_key"`
	Fingerprint types.String `tfsdk:"fingerprint"`
}

func NewSshKeyResource() resource.Resource { return &sshKeyResource{} }

func (r *sshKeyResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_ssh_key"
}

func (r *sshKeyResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	forceNew := []planmodifier.String{stringplanmodifier.RequiresReplace()}
	res.Schema = schema.Schema{
		Description: "An SSH public key on the account, injected into every server created afterwards.",
		Attributes: map[string]schema.Attribute{
			"id":          schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"name":        schema.StringAttribute{Required: true, PlanModifiers: forceNew},
			"public_key":  schema.StringAttribute{Required: true, PlanModifiers: forceNew},
			"fingerprint": schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
		},
	}
}

func (r *sshKeyResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func (r *sshKeyResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m sshKeyModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var k client.SshKey
	if err := r.c.Do(ctx, http.MethodPost, "/v1/ssh-keys", map[string]string{"name": m.Name.ValueString(), "publicKey": m.PublicKey.ValueString()}, &k); err != nil {
		res.Diagnostics.AddError("Creating SSH key", err.Error())
		return
	}
	m.ID, m.Fingerprint = types.StringValue(k.ID), types.StringValue(k.Fingerprint)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *sshKeyResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m sshKeyModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var list struct {
		Data []client.SshKey `json:"data"`
	}
	if err := r.c.Do(ctx, http.MethodGet, "/v1/ssh-keys", nil, &list); err != nil {
		res.Diagnostics.AddError("Reading SSH keys", err.Error())
		return
	}
	for _, k := range list.Data {
		if k.ID == m.ID.ValueString() {
			m.Name, m.Fingerprint = types.StringValue(k.Name), types.StringValue(k.Fingerprint)
			if k.PublicKey != "" {
				m.PublicKey = types.StringValue(k.PublicKey)
			}
			res.Diagnostics.Append(res.State.Set(ctx, &m)...)
			return
		}
	}
	res.State.RemoveResource(ctx)
}

func (r *sshKeyResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var m sshKeyModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *sshKeyResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m sshKeyModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/ssh-keys/"+m.ID.ValueString(), nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Deleting SSH key", err.Error())
	}
}

func (r *sshKeyResource) ImportState(ctx context.Context, req resource.ImportStateRequest, res *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, res)
}
