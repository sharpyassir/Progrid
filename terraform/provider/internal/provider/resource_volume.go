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

// volumeResource manages a block volume. size_gb grows in place; server_id attaches or
// detaches in place; name and region replace the volume.
type volumeResource struct{ c *client.Client }

type volumeModel struct {
	ID       types.String `tfsdk:"id"`
	Name     types.String `tfsdk:"name"`
	SizeGb   types.Int64  `tfsdk:"size_gb"`
	Region   types.String `tfsdk:"region"`
	ServerID types.String `tfsdk:"server_id"`
	Device   types.String `tfsdk:"device"`
	Status   types.String `tfsdk:"status"`
}

func NewVolumeResource() resource.Resource { return &volumeResource{} }

func (r *volumeResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_volume"
}

func (r *volumeResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	forceNew := []planmodifier.String{stringplanmodifier.RequiresReplace()}
	computed := []planmodifier.String{stringplanmodifier.UseStateForUnknown()}
	res.Schema = schema.Schema{
		Description: "A block volume (10 GB to 16 TB) that attaches to one server at a time. Growing size_gb resizes in place; changing server_id moves the volume; the guest sees it at `device`.",
		Attributes: map[string]schema.Attribute{
			"id":        schema.StringAttribute{Computed: true, PlanModifiers: computed},
			"name":      schema.StringAttribute{Required: true, PlanModifiers: forceNew},
			"size_gb":   schema.Int64Attribute{Required: true, Description: "Size in GB. Only grows."},
			"region":    schema.StringAttribute{Optional: true, Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace(), stringplanmodifier.UseStateForUnknown()}},
			"server_id": schema.StringAttribute{Optional: true, Description: "Server to attach to. Unset to detach."},
			"device":    schema.StringAttribute{Computed: true, Description: "Guest path under /dev/disk/by-id while attached."},
			"status":    schema.StringAttribute{Computed: true},
		},
	}
}

func (r *volumeResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func (r *volumeResource) apply(m *volumeModel, v *client.Volume) {
	m.ID, m.Name, m.SizeGb, m.Region, m.Status = types.StringValue(v.ID), types.StringValue(v.Name), types.Int64Value(int64(v.SizeGb)), types.StringValue(v.RegionID), types.StringValue(v.Status)
	if v.ServerID != nil {
		m.ServerID = types.StringValue(*v.ServerID)
	} else {
		m.ServerID = types.StringNull()
	}
	if v.Device != nil {
		m.Device = types.StringValue(*v.Device)
	} else {
		m.Device = types.StringNull()
	}
}

func (r *volumeResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m volumeModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	body := map[string]interface{}{"name": m.Name.ValueString(), "sizeGb": m.SizeGb.ValueInt64()}
	if !m.Region.IsNull() && !m.Region.IsUnknown() {
		body["region"] = m.Region.ValueString()
	}
	if !m.ServerID.IsNull() && !m.ServerID.IsUnknown() && m.ServerID.ValueString() != "" {
		body["serverId"] = m.ServerID.ValueString()
	}
	var v client.Volume
	if err := r.c.Do(ctx, http.MethodPost, "/v1/volumes", body, &v); err != nil {
		res.Diagnostics.AddError("Creating volume", err.Error())
		return
	}
	settled, err := r.c.WaitVolume(ctx, v.ID, 10*time.Minute)
	if settled != nil {
		r.apply(&m, settled)
		res.Diagnostics.Append(res.State.Set(ctx, &m)...)
	}
	if err != nil {
		res.Diagnostics.AddError("Waiting for volume", err.Error())
	}
}

func (r *volumeResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m volumeModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var v client.Volume
	if err := r.c.Do(ctx, http.MethodGet, "/v1/volumes/"+m.ID.ValueString(), nil, &v); err != nil {
		if client.IsNotFound(err) {
			res.State.RemoveResource(ctx)
			return
		}
		res.Diagnostics.AddError("Reading volume", err.Error())
		return
	}
	if v.Status == "deleted" || v.Status == "deleting" {
		res.State.RemoveResource(ctx)
		return
	}
	r.apply(&m, &v)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *volumeResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var plan, state volumeModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	res.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if res.Diagnostics.HasError() {
		return
	}
	id := state.ID.ValueString()
	want := ""
	if !plan.ServerID.IsNull() && !plan.ServerID.IsUnknown() {
		want = plan.ServerID.ValueString()
	}
	have := ""
	if !state.ServerID.IsNull() {
		have = state.ServerID.ValueString()
	}
	step := func(what string, err error) bool {
		if err != nil {
			res.Diagnostics.AddError(what, err.Error())
			return false
		}
		if _, err := r.c.WaitVolume(ctx, id, 10*time.Minute); err != nil {
			res.Diagnostics.AddError(what, err.Error())
			return false
		}
		return true
	}
	// Move: detach from the old server before attaching to the new one.
	if have != "" && have != want {
		if !step("Detaching volume", r.c.Do(ctx, http.MethodPost, "/v1/volumes/"+id+"/detach", map[string]string{}, nil)) {
			return
		}
	}
	if plan.SizeGb.ValueInt64() > state.SizeGb.ValueInt64() {
		if !step("Growing volume", r.c.Do(ctx, http.MethodPost, "/v1/volumes/"+id+"/resize", map[string]int64{"sizeGb": plan.SizeGb.ValueInt64()}, nil)) {
			return
		}
	} else if plan.SizeGb.ValueInt64() < state.SizeGb.ValueInt64() {
		res.Diagnostics.AddError("Shrinking volume", fmt.Sprintf("volumes only grow; %d GB is smaller than the current %d GB", plan.SizeGb.ValueInt64(), state.SizeGb.ValueInt64()))
		return
	}
	if want != "" && want != have {
		if !step("Attaching volume", r.c.Do(ctx, http.MethodPost, "/v1/volumes/"+id+"/attach", map[string]string{"serverId": want}, nil)) {
			return
		}
	}
	var v client.Volume
	if err := r.c.Do(ctx, http.MethodGet, "/v1/volumes/"+id, nil, &v); err != nil {
		res.Diagnostics.AddError("Reading volume", err.Error())
		return
	}
	r.apply(&plan, &v)
	res.Diagnostics.Append(res.State.Set(ctx, &plan)...)
}

func (r *volumeResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m volumeModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	id := m.ID.ValueString()
	if !m.ServerID.IsNull() && m.ServerID.ValueString() != "" {
		if err := r.c.Do(ctx, http.MethodPost, "/v1/volumes/"+id+"/detach", map[string]string{}, nil); err != nil && !client.IsNotFound(err) {
			res.Diagnostics.AddError("Detaching volume", err.Error())
			return
		}
		if _, err := r.c.WaitVolume(ctx, id, 10*time.Minute); err != nil && !client.IsNotFound(err) {
			res.Diagnostics.AddError("Detaching volume", err.Error())
			return
		}
	}
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/volumes/"+id, nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Deleting volume", err.Error())
	}
}

func (r *volumeResource) ImportState(ctx context.Context, req resource.ImportStateRequest, res *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, res)
}
