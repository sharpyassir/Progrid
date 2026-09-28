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

type firewallResource struct{ c *client.Client }

type ruleModel struct {
	Direction types.String `tfsdk:"direction"`
	Protocol  types.String `tfsdk:"protocol"`
	Ports     types.String `tfsdk:"ports"`
	Cidrs     types.List   `tfsdk:"cidrs"`
}

type firewallModel struct {
	ID    types.String `tfsdk:"id"`
	Name  types.String `tfsdk:"name"`
	Rules []ruleModel  `tfsdk:"rule"`
}

func NewFirewallResource() resource.Resource { return &firewallResource{} }

func (r *firewallResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_firewall"
}

func (r *firewallResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	res.Schema = schema.Schema{
		Description: "A host enforced firewall. Rules are replaced as a set; attach it to servers with the server's firewalls attribute. The API has no rule update, so a rule change replaces the firewall.",
		Attributes: map[string]schema.Attribute{
			"id":   schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"name": schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
		},
		Blocks: map[string]schema.Block{
			"rule": schema.ListNestedBlock{
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"direction": schema.StringAttribute{Required: true, Description: "inbound or outbound"},
						"protocol":  schema.StringAttribute{Required: true, Description: "tcp, udp, icmp or any"},
						"ports":     schema.StringAttribute{Optional: true, Description: "Port or range, for example 22 or 80-443"},
						"cidrs":     schema.ListAttribute{ElementType: types.StringType, Required: true},
					},
				},
			},
		},
	}
}

func (r *firewallResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func (r *firewallResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m firewallModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	rules := make([]map[string]interface{}, 0, len(m.Rules))
	for _, rule := range m.Rules {
		x := map[string]interface{}{"direction": rule.Direction.ValueString(), "protocol": rule.Protocol.ValueString(), "cidrs": strings(ctx, rule.Cidrs)}
		if !rule.Ports.IsNull() && rule.Ports.ValueString() != "" {
			x["ports"] = rule.Ports.ValueString()
		}
		rules = append(rules, x)
	}
	var fw client.Firewall
	if err := r.c.Do(ctx, http.MethodPost, "/v1/firewalls", map[string]interface{}{"name": m.Name.ValueString(), "rules": rules}, &fw); err != nil {
		res.Diagnostics.AddError("Creating firewall", err.Error())
		return
	}
	m.ID = types.StringValue(fw.ID)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *firewallResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m firewallModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var fw client.Firewall
	err := r.c.Do(ctx, http.MethodGet, "/v1/firewalls/"+m.ID.ValueString(), nil, &fw)
	if client.IsNotFound(err) {
		res.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		res.Diagnostics.AddError("Reading firewall", err.Error())
		return
	}
	m.Name = types.StringValue(fw.Name)
	m.Rules = m.Rules[:0]
	for _, rule := range fw.Rules {
		rm := ruleModel{Direction: types.StringValue(rule.Direction), Protocol: types.StringValue(rule.Protocol), Cidrs: stringList(rule.Cidrs), Ports: types.StringNull()}
		if rule.Ports != nil && *rule.Ports != "" {
			rm.Ports = types.StringValue(*rule.Ports)
		}
		m.Rules = append(m.Rules, rm)
	}
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

// Update never runs for attribute changes (name and rules force replacement); kept for the interface.
func (r *firewallResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var m firewallModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *firewallResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m firewallModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/firewalls/"+m.ID.ValueString(), nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Deleting firewall", err.Error())
	}
}

func (r *firewallResource) ImportState(ctx context.Context, req resource.ImportStateRequest, res *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, res)
}

func (r *firewallResource) ModifyPlan(ctx context.Context, req resource.ModifyPlanRequest, res *resource.ModifyPlanResponse) {
	// Any rule change replaces the firewall: the API replaces rule sets only on create.
	if req.State.Raw.IsNull() || req.Plan.Raw.IsNull() {
		return
	}
	var plan, state firewallModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	res.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if res.Diagnostics.HasError() {
		return
	}
	if !rulesEqual(ctx, plan.Rules, state.Rules) {
		res.RequiresReplace = append(res.RequiresReplace, path.Root("rule"))
	}
}

func rulesEqual(ctx context.Context, a, b []ruleModel) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Direction.ValueString() != b[i].Direction.ValueString() || a[i].Protocol.ValueString() != b[i].Protocol.ValueString() || a[i].Ports.ValueString() != b[i].Ports.ValueString() {
			return false
		}
		x, y := strings(ctx, a[i].Cidrs), strings(ctx, b[i].Cidrs)
		if len(x) != len(y) {
			return false
		}
		for j := range x {
			if x[j] != y[j] {
				return false
			}
		}
	}
	return true
}
