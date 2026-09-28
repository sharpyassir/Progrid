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

// loadBalancerResource manages a managed HAProxy load balancer. Rules, health check,
// algorithm, tag and the target set update in place; name, region and nodes replace it.
type loadBalancerResource struct{ c *client.Client }

type forwardingRuleModel struct {
	EntryProtocol  types.String `tfsdk:"entry_protocol"`
	EntryPort      types.Int64  `tfsdk:"entry_port"`
	TargetProtocol types.String `tfsdk:"target_protocol"`
	TargetPort     types.Int64  `tfsdk:"target_port"`
	CertificateID  types.String `tfsdk:"certificate_id"`
}

type loadBalancerModel struct {
	ID                  types.String          `tfsdk:"id"`
	Name                types.String          `tfsdk:"name"`
	Region              types.String          `tfsdk:"region"`
	Nodes               types.Int64           `tfsdk:"nodes"`
	Algorithm           types.String          `tfsdk:"algorithm"`
	RedirectHTTPToHTTPS types.Bool            `tfsdk:"redirect_http_to_https"`
	StickySessions      types.Bool            `tfsdk:"sticky_sessions"`
	HealthCheckPath     types.String          `tfsdk:"health_check_path"`
	Tag                 types.String          `tfsdk:"tag"`
	ServerIDs           types.List            `tfsdk:"server_ids"`
	IP                  types.String          `tfsdk:"ip"`
	Status              types.String          `tfsdk:"status"`
	Rules               []forwardingRuleModel `tfsdk:"forwarding_rule"`
}

func NewLoadBalancerResource() resource.Resource { return &loadBalancerResource{} }

func (r *loadBalancerResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_load_balancer"
}

func (r *loadBalancerResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	forceNew := []planmodifier.String{stringplanmodifier.RequiresReplace()}
	res.Schema = schema.Schema{
		Description: "A managed HAProxy load balancer with its own public IP. Forwarding rules, health check, algorithm, tag and targets change in place; name, region and nodes replace it.",
		Attributes: map[string]schema.Attribute{
			"id":                     schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"name":                   schema.StringAttribute{Required: true, PlanModifiers: forceNew},
			"region":                 schema.StringAttribute{Optional: true, Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace(), stringplanmodifier.UseStateForUnknown()}},
			"nodes":                  schema.Int64Attribute{Optional: true, Computed: true, Description: "HAProxy nodes sharing the IP, 1 to 3", PlanModifiers: []planmodifier.Int64{int64planmodifier.RequiresReplace(), int64planmodifier.UseStateForUnknown()}},
			"algorithm":              schema.StringAttribute{Optional: true, Computed: true, Description: "round_robin or least_conn"},
			"redirect_http_to_https": schema.BoolAttribute{Optional: true, Computed: true},
			"sticky_sessions":        schema.BoolAttribute{Optional: true, Computed: true, Description: "Cookie based session stickiness"},
			"health_check_path":      schema.StringAttribute{Optional: true, Computed: true},
			"tag":                    schema.StringAttribute{Optional: true, Description: "Servers carrying this tag are targets automatically"},
			"server_ids":             schema.ListAttribute{ElementType: types.StringType, Optional: true, Description: "Explicit target servers"},
			"ip":                     schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"status":                 schema.StringAttribute{Computed: true},
		},
		Blocks: map[string]schema.Block{
			"forwarding_rule": schema.ListNestedBlock{
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"entry_protocol":  schema.StringAttribute{Required: true, Description: "http, https or tcp"},
						"entry_port":      schema.Int64Attribute{Required: true},
						"target_protocol": schema.StringAttribute{Required: true, Description: "http or tcp"},
						"target_port":     schema.Int64Attribute{Required: true},
						"certificate_id":  schema.StringAttribute{Optional: true, Description: "Required for https"},
					},
				},
			},
		},
	}
}

func (r *loadBalancerResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func rulesBody(m *loadBalancerModel) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(m.Rules))
	for _, rule := range m.Rules {
		x := map[string]interface{}{"entryProtocol": rule.EntryProtocol.ValueString(), "entryPort": rule.EntryPort.ValueInt64(), "targetProtocol": rule.TargetProtocol.ValueString(), "targetPort": rule.TargetPort.ValueInt64()}
		if !rule.CertificateID.IsNull() && rule.CertificateID.ValueString() != "" {
			x["certificateId"] = rule.CertificateID.ValueString()
		}
		out = append(out, x)
	}
	return out
}

func settingsBody(m *loadBalancerModel) map[string]interface{} {
	body := map[string]interface{}{"forwardingRules": rulesBody(m)}
	if !m.Algorithm.IsNull() && !m.Algorithm.IsUnknown() {
		body["algorithm"] = m.Algorithm.ValueString()
	}
	if !m.RedirectHTTPToHTTPS.IsNull() && !m.RedirectHTTPToHTTPS.IsUnknown() {
		body["redirectHttpToHttps"] = m.RedirectHTTPToHTTPS.ValueBool()
	}
	if !m.StickySessions.IsNull() && !m.StickySessions.IsUnknown() {
		t := "none"
		if m.StickySessions.ValueBool() {
			t = "cookie"
		}
		body["stickySessions"] = map[string]string{"type": t}
	}
	if !m.HealthCheckPath.IsNull() && !m.HealthCheckPath.IsUnknown() && m.HealthCheckPath.ValueString() != "" {
		body["healthCheck"] = map[string]string{"path": m.HealthCheckPath.ValueString()}
	}
	if !m.Tag.IsNull() {
		body["tag"] = m.Tag.ValueString()
	}
	return body
}

func (r *loadBalancerResource) apply(m *loadBalancerModel, lb *client.LoadBalancer) {
	m.ID, m.Name, m.Region, m.Nodes, m.Algorithm, m.Status = types.StringValue(lb.ID), types.StringValue(lb.Name), types.StringValue(lb.RegionID), types.Int64Value(int64(lb.Nodes)), types.StringValue(lb.Algorithm), types.StringValue(lb.Status)
	m.RedirectHTTPToHTTPS, m.StickySessions = types.BoolValue(lb.RedirectHTTPToHTTPS), types.BoolValue(lb.StickySessions != nil)
	m.HealthCheckPath = types.StringValue(lb.HealthCheck.Path)
	if lb.IP != nil {
		m.IP = types.StringValue(*lb.IP)
	} else {
		m.IP = types.StringNull()
	}
	if lb.Tag != nil {
		m.Tag = types.StringValue(*lb.Tag)
	} else {
		m.Tag = types.StringNull()
	}
	m.Rules = m.Rules[:0]
	for _, rule := range lb.ForwardingRules {
		rm := forwardingRuleModel{EntryProtocol: types.StringValue(rule.EntryProtocol), EntryPort: types.Int64Value(int64(rule.EntryPort)), TargetProtocol: types.StringValue(rule.TargetProtocol), TargetPort: types.Int64Value(int64(rule.TargetPort)), CertificateID: types.StringNull()}
		if rule.CertificateID != "" {
			rm.CertificateID = types.StringValue(rule.CertificateID)
		}
		m.Rules = append(m.Rules, rm)
	}
	ids := make([]string, 0, len(lb.Targets))
	for _, t := range lb.Targets {
		ids = append(ids, t.ServerID)
	}
	if len(ids) > 0 || !m.ServerIDs.IsNull() {
		m.ServerIDs = stringList(ids)
	}
}

func (r *loadBalancerResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m loadBalancerModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	body := settingsBody(&m)
	body["name"] = m.Name.ValueString()
	if !m.Region.IsNull() && !m.Region.IsUnknown() {
		body["region"] = m.Region.ValueString()
	}
	if !m.Nodes.IsNull() && !m.Nodes.IsUnknown() {
		body["nodes"] = m.Nodes.ValueInt64()
	}
	if !m.ServerIDs.IsNull() {
		body["serverIds"] = strings(ctx, m.ServerIDs)
	}
	var lb client.LoadBalancer
	if err := r.c.Do(ctx, http.MethodPost, "/v1/load-balancers", body, &lb); err != nil {
		res.Diagnostics.AddError("Creating load balancer", err.Error())
		return
	}
	settled, err := r.c.WaitLoadBalancer(ctx, lb.ID, 20*time.Minute)
	if settled != nil {
		r.apply(&m, settled)
		res.Diagnostics.Append(res.State.Set(ctx, &m)...)
	}
	if err != nil {
		res.Diagnostics.AddError("Waiting for load balancer", err.Error())
	}
}

func (r *loadBalancerResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m loadBalancerModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var lb client.LoadBalancer
	if err := r.c.Do(ctx, http.MethodGet, "/v1/load-balancers/"+m.ID.ValueString(), nil, &lb); err != nil {
		if client.IsNotFound(err) {
			res.State.RemoveResource(ctx)
			return
		}
		res.Diagnostics.AddError("Reading load balancer", err.Error())
		return
	}
	if lb.Status == "deleted" || lb.Status == "deleting" {
		res.State.RemoveResource(ctx)
		return
	}
	r.apply(&m, &lb)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *loadBalancerResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var plan, state loadBalancerModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	res.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if res.Diagnostics.HasError() {
		return
	}
	id := state.ID.ValueString()
	if err := r.c.Do(ctx, http.MethodPatch, "/v1/load-balancers/"+id, settingsBody(&plan), nil); err != nil {
		res.Diagnostics.AddError("Updating load balancer", err.Error())
		return
	}
	want := map[string]bool{}
	for _, s := range strings(ctx, plan.ServerIDs) {
		want[s] = true
	}
	have := map[string]bool{}
	for _, s := range strings(ctx, state.ServerIDs) {
		have[s] = true
	}
	add := []string{}
	for s := range want {
		if !have[s] {
			add = append(add, s)
		}
	}
	if len(add) > 0 {
		if err := r.c.Do(ctx, http.MethodPost, "/v1/load-balancers/"+id+"/servers", map[string]interface{}{"serverIds": add}, nil); err != nil {
			res.Diagnostics.AddError("Adding targets", err.Error())
			return
		}
	}
	for s := range have {
		if !want[s] {
			if err := r.c.Do(ctx, http.MethodDelete, "/v1/load-balancers/"+id+"/servers/"+s, nil, nil); err != nil && !client.IsNotFound(err) {
				res.Diagnostics.AddError("Removing target", err.Error())
				return
			}
		}
	}
	lb, err := r.c.WaitLoadBalancer(ctx, id, 20*time.Minute)
	if err != nil {
		res.Diagnostics.AddError("Waiting for load balancer", err.Error())
		return
	}
	r.apply(&plan, lb)
	res.Diagnostics.Append(res.State.Set(ctx, &plan)...)
}

func (r *loadBalancerResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m loadBalancerModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/load-balancers/"+m.ID.ValueString(), nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Deleting load balancer", err.Error())
	}
}

func (r *loadBalancerResource) ImportState(ctx context.Context, req resource.ImportStateRequest, res *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, res)
}
