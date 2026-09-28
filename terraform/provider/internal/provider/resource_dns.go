package provider

import (
	"context"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/int64planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/prgd/terraform-provider-prgd/internal/client"
)

// ---- prgd_domain: a hosted zone ----

type domainResource struct{ c *client.Client }

type domainModel struct {
	ID          types.String `tfsdk:"id"`
	Name        types.String `tfsdk:"name"`
	Nameservers types.List   `tfsdk:"nameservers"`
}

func NewDomainResource() resource.Resource { return &domainResource{} }

func (r *domainResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_domain"
}

func (r *domainResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	res.Schema = schema.Schema{
		Description: "A DNS zone hosted on prgd nameservers. Point the domain's nameservers at the `nameservers` output. Records are prgd_dns_record resources.",
		Attributes: map[string]schema.Attribute{
			"id":          schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"name":        schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"nameservers": schema.ListAttribute{ElementType: types.StringType, Computed: true},
		},
	}
}

func (r *domainResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func (r *domainResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m domainModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var d client.Domain
	if err := r.c.Do(ctx, http.MethodPost, "/v1/domains", map[string]string{"name": m.Name.ValueString()}, &d); err != nil {
		res.Diagnostics.AddError("Creating domain", err.Error())
		return
	}
	m.ID, m.Nameservers = types.StringValue(d.ID), stringList(d.Nameservers)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *domainResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m domainModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var d client.Domain
	if err := r.c.Do(ctx, http.MethodGet, "/v1/domains/"+m.Name.ValueString(), nil, &d); err != nil {
		if client.IsNotFound(err) {
			res.State.RemoveResource(ctx)
			return
		}
		res.Diagnostics.AddError("Reading domain", err.Error())
		return
	}
	m.ID, m.Nameservers = types.StringValue(d.ID), stringList(d.Nameservers)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *domainResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var m domainModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *domainResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m domainModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/domains/"+m.Name.ValueString(), nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Deleting domain", err.Error())
	}
}

func (r *domainResource) ImportState(ctx context.Context, req resource.ImportStateRequest, res *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("name"), req, res)
}

// ---- prgd_dns_record ----

type dnsRecordResource struct{ c *client.Client }

type dnsRecordModel struct {
	ID       types.String `tfsdk:"id"`
	Domain   types.String `tfsdk:"domain"`
	Name     types.String `tfsdk:"name"`
	Type     types.String `tfsdk:"type"`
	Value    types.String `tfsdk:"value"`
	TTL      types.Int64  `tfsdk:"ttl"`
	Priority types.Int64  `tfsdk:"priority"`
}

func NewDnsRecordResource() resource.Resource { return &dnsRecordResource{} }

func (r *dnsRecordResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_dns_record"
}

func (r *dnsRecordResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	res.Schema = schema.Schema{
		Description: "A record in a prgd_domain. name is relative to the zone (\"@\" for the apex). Type changes replace the record; everything else updates in place.",
		Attributes: map[string]schema.Attribute{
			"id":       schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"domain":   schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"name":     schema.StringAttribute{Required: true},
			"type":     schema.StringAttribute{Required: true, Description: "A, AAAA, CNAME, MX, TXT, NS, SRV or CAA", PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"value":    schema.StringAttribute{Required: true},
			"ttl":      schema.Int64Attribute{Optional: true, Computed: true, PlanModifiers: []planmodifier.Int64{int64planmodifier.UseStateForUnknown()}},
			"priority": schema.Int64Attribute{Optional: true, Computed: true, Description: "MX preference or SRV priority", PlanModifiers: []planmodifier.Int64{int64planmodifier.UseStateForUnknown()}},
		},
	}
}

func (r *dnsRecordResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func (r *dnsRecordResource) body(m *dnsRecordModel, withType bool) map[string]interface{} {
	b := map[string]interface{}{"name": m.Name.ValueString(), "content": m.Value.ValueString()}
	if withType {
		b["type"] = m.Type.ValueString()
	}
	if !m.TTL.IsNull() && !m.TTL.IsUnknown() {
		b["ttl"] = m.TTL.ValueInt64()
	}
	if !m.Priority.IsNull() && !m.Priority.IsUnknown() {
		b["priority"] = m.Priority.ValueInt64()
	}
	return b
}

func (r *dnsRecordResource) apply(m *dnsRecordModel, rec *client.DnsRecord) {
	m.ID, m.Name, m.Type, m.Value, m.TTL = types.StringValue(rec.ID), types.StringValue(rec.Name), types.StringValue(rec.Type), types.StringValue(rec.Content), types.Int64Value(int64(rec.TTL))
	if rec.Priority != nil {
		m.Priority = types.Int64Value(int64(*rec.Priority))
	} else {
		m.Priority = types.Int64Null()
	}
}

func (r *dnsRecordResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m dnsRecordModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var rec client.DnsRecord
	if err := r.c.Do(ctx, http.MethodPost, "/v1/domains/"+m.Domain.ValueString()+"/records", r.body(&m, true), &rec); err != nil {
		res.Diagnostics.AddError("Creating DNS record", err.Error())
		return
	}
	r.apply(&m, &rec)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *dnsRecordResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m dnsRecordModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var d client.Domain
	if err := r.c.Do(ctx, http.MethodGet, "/v1/domains/"+m.Domain.ValueString(), nil, &d); err != nil {
		if client.IsNotFound(err) {
			res.State.RemoveResource(ctx)
			return
		}
		res.Diagnostics.AddError("Reading domain", err.Error())
		return
	}
	for i := range d.Records {
		if d.Records[i].ID == m.ID.ValueString() {
			r.apply(&m, &d.Records[i])
			res.Diagnostics.Append(res.State.Set(ctx, &m)...)
			return
		}
	}
	res.State.RemoveResource(ctx)
}

func (r *dnsRecordResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var plan, state dnsRecordModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	res.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if res.Diagnostics.HasError() {
		return
	}
	var rec client.DnsRecord
	if err := r.c.Do(ctx, http.MethodPatch, "/v1/domains/"+plan.Domain.ValueString()+"/records/"+state.ID.ValueString(), r.body(&plan, false), &rec); err != nil {
		res.Diagnostics.AddError("Updating DNS record", err.Error())
		return
	}
	r.apply(&plan, &rec)
	res.Diagnostics.Append(res.State.Set(ctx, &plan)...)
}

func (r *dnsRecordResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m dnsRecordModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/domains/"+m.Domain.ValueString()+"/records/"+m.ID.ValueString(), nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Deleting DNS record", err.Error())
	}
}
