package provider

import (
	"context"
	"net/http"
	"time"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/boolplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/prgd/terraform-provider-prgd/internal/client"
)

type kubernetesModel struct {
	ID         types.String `tfsdk:"id"`
	Name       types.String `tfsdk:"name"`
	Version    types.String `tfsdk:"version"`
	Region     types.String `tfsdk:"region"`
	HA         types.Bool   `tfsdk:"ha"`
	PoolName   types.String `tfsdk:"pool_name"`
	PoolSize   types.String `tfsdk:"pool_size"`
	PoolCount  types.Int64  `tfsdk:"pool_count"`
	PoolID     types.String `tfsdk:"pool_id"`
	Endpoint   types.String `tfsdk:"endpoint"`
	Kubeconfig types.String `tfsdk:"kubeconfig"`
	Status     types.String `tfsdk:"status"`
}

type kubernetesResource struct{ c *client.Client }

func NewKubernetesResource() resource.Resource { return &kubernetesResource{} }

func (r *kubernetesResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_kubernetes_cluster"
}

func (r *kubernetesResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	forceNew := []planmodifier.String{stringplanmodifier.RequiresReplace()}
	computed := []planmodifier.String{stringplanmodifier.UseStateForUnknown()}
	res.Schema = schema.Schema{
		Description: "A managed Kubernetes cluster with one worker pool. Workers are billed as servers; three control plane nodes carry a flat fee. The kubeconfig is sensitive.",
		Attributes: map[string]schema.Attribute{
			"id":         schema.StringAttribute{Computed: true, PlanModifiers: computed},
			"name":       schema.StringAttribute{Required: true, PlanModifiers: forceNew},
			"version":    schema.StringAttribute{Optional: true, Computed: true, Description: "Kubernetes minor version, for example 1.31", PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace(), stringplanmodifier.UseStateForUnknown()}},
			"region":     schema.StringAttribute{Optional: true, Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace(), stringplanmodifier.UseStateForUnknown()}},
			"ha":         schema.BoolAttribute{Optional: true, Computed: true, Description: "Three control plane nodes instead of one", PlanModifiers: []planmodifier.Bool{boolplanmodifier.RequiresReplace(), boolplanmodifier.UseStateForUnknown()}},
			"pool_name":  schema.StringAttribute{Optional: true, Computed: true, Description: "Name of the worker pool (default: default)", PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace(), stringplanmodifier.UseStateForUnknown()}},
			"pool_size":  schema.StringAttribute{Required: true, Description: "Server size id for the workers, at least 2 GB of memory", PlanModifiers: forceNew},
			"pool_count": schema.Int64Attribute{Required: true, Description: "Number of workers; changing it scales the pool"},
			"pool_id":    schema.StringAttribute{Computed: true, PlanModifiers: computed},
			"endpoint":   schema.StringAttribute{Computed: true, PlanModifiers: computed},
			"kubeconfig": schema.StringAttribute{Computed: true, Sensitive: true},
			"status":     schema.StringAttribute{Computed: true},
		},
	}
}

func (r *kubernetesResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func (r *kubernetesResource) apply(ctx context.Context, m *kubernetesModel, k *client.KubeCluster) {
	m.ID, m.Name, m.Version, m.Region, m.HA, m.Status = types.StringValue(k.ID), types.StringValue(k.Name), types.StringValue(k.Version), types.StringValue(k.Region.ID), types.BoolValue(k.HA), types.StringValue(k.Status)
	m.Endpoint = types.StringValue(str(k.Endpoint))
	if len(k.Pools) > 0 {
		p := k.Pools[0]
		m.PoolID, m.PoolName, m.PoolSize, m.PoolCount = types.StringValue(p.ID), types.StringValue(p.Name), types.StringValue(p.Size.ID), types.Int64Value(int64(p.Count))
	}
	if k.Status == "active" {
		if text, err := r.c.DoText(ctx, http.MethodGet, "/v1/kubernetes/clusters/"+k.ID+"/kubeconfig"); err == nil {
			m.Kubeconfig = types.StringValue(text)
		}
	}
	if m.Kubeconfig.IsUnknown() {
		m.Kubeconfig = types.StringValue("")
	}
}

func (r *kubernetesResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m kubernetesModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	poolName := "default"
	if !m.PoolName.IsNull() && !m.PoolName.IsUnknown() && m.PoolName.ValueString() != "" {
		poolName = m.PoolName.ValueString()
	}
	body := map[string]interface{}{"name": m.Name.ValueString(), "pools": []map[string]interface{}{{"name": poolName, "size": m.PoolSize.ValueString(), "count": m.PoolCount.ValueInt64()}}}
	for k, v := range map[string]types.String{"version": m.Version, "region": m.Region} {
		if !v.IsNull() && !v.IsUnknown() && v.ValueString() != "" {
			body[k] = v.ValueString()
		}
	}
	if !m.HA.IsNull() && !m.HA.IsUnknown() {
		body["ha"] = m.HA.ValueBool()
	}
	var k client.KubeCluster
	if err := r.c.Do(ctx, http.MethodPost, "/v1/kubernetes/clusters", body, &k); err != nil {
		res.Diagnostics.AddError("Creating kubernetes cluster", err.Error())
		return
	}
	settled, err := r.c.WaitKubernetes(ctx, k.ID, 40*time.Minute)
	if settled != nil {
		r.apply(ctx, &m, settled)
		res.Diagnostics.Append(res.State.Set(ctx, &m)...)
	}
	if err != nil {
		res.Diagnostics.AddError("Waiting for kubernetes cluster", err.Error())
	}
}

func (r *kubernetesResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m kubernetesModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var k client.KubeCluster
	if err := r.c.Do(ctx, http.MethodGet, "/v1/kubernetes/clusters/"+m.ID.ValueString(), nil, &k); err != nil {
		if client.IsNotFound(err) {
			res.State.RemoveResource(ctx)
			return
		}
		res.Diagnostics.AddError("Reading kubernetes cluster", err.Error())
		return
	}
	if k.Status == "deleted" || k.Status == "deleting" {
		res.State.RemoveResource(ctx)
		return
	}
	r.apply(ctx, &m, &k)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *kubernetesResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var plan, state kubernetesModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	res.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if res.Diagnostics.HasError() {
		return
	}
	id := state.ID.ValueString()
	if plan.PoolCount.ValueInt64() != state.PoolCount.ValueInt64() {
		if err := r.c.Do(ctx, http.MethodPatch, "/v1/kubernetes/clusters/"+id+"/pools/"+state.PoolID.ValueString(), map[string]interface{}{"count": plan.PoolCount.ValueInt64()}, nil); err != nil {
			res.Diagnostics.AddError("Scaling pool", err.Error())
			return
		}
	}
	k, err := r.c.WaitKubernetes(ctx, id, 40*time.Minute)
	if err != nil {
		res.Diagnostics.AddError("Waiting for kubernetes cluster", err.Error())
		return
	}
	r.apply(ctx, &plan, k)
	res.Diagnostics.Append(res.State.Set(ctx, &plan)...)
}

func (r *kubernetesResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m kubernetesModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/kubernetes/clusters/"+m.ID.ValueString(), nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Deleting kubernetes cluster", err.Error())
	}
}

func (r *kubernetesResource) ImportState(ctx context.Context, req resource.ImportStateRequest, res *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, res)
}

var _ attr.Value = types.StringValue("")
