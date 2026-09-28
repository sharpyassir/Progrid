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

// ---- prgd_bucket ----

type bucketResource struct{ c *client.Client }

type bucketModel struct {
	ID       types.String `tfsdk:"id"`
	Name     types.String `tfsdk:"name"`
	Region   types.String `tfsdk:"region"`
	Public   types.Bool   `tfsdk:"public"`
	Endpoint types.String `tfsdk:"endpoint"`
	URL      types.String `tfsdk:"url"`
}

func NewBucketResource() resource.Resource { return &bucketResource{} }

func (r *bucketResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_bucket"
}

func (r *bucketResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	res.Schema = schema.Schema{
		Description: "An S3 compatible bucket. Names are global. `public` toggles anonymous read in place; name and region replace the bucket. The bucket must be empty to be destroyed.",
		Attributes: map[string]schema.Attribute{
			"id":       schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"name":     schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"region":   schema.StringAttribute{Optional: true, Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace(), stringplanmodifier.UseStateForUnknown()}},
			"public":   schema.BoolAttribute{Optional: true, Computed: true},
			"endpoint": schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"url":      schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
		},
	}
}

func (r *bucketResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func (r *bucketResource) apply(m *bucketModel, b *client.Bucket) {
	m.ID, m.Name, m.Region, m.Public, m.Endpoint, m.URL = types.StringValue(b.ID), types.StringValue(b.Name), types.StringValue(b.RegionID), types.BoolValue(b.Public), types.StringValue(b.Endpoint), types.StringValue(b.URL)
}

func (r *bucketResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m bucketModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	body := map[string]interface{}{"name": m.Name.ValueString()}
	if !m.Region.IsNull() && !m.Region.IsUnknown() {
		body["region"] = m.Region.ValueString()
	}
	if !m.Public.IsNull() && !m.Public.IsUnknown() {
		body["public"] = m.Public.ValueBool()
	}
	var b client.Bucket
	if err := r.c.Do(ctx, http.MethodPost, "/v1/buckets", body, &b); err != nil {
		res.Diagnostics.AddError("Creating bucket", err.Error())
		return
	}
	r.apply(&m, &b)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *bucketResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m bucketModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var b client.Bucket
	if err := r.c.Do(ctx, http.MethodGet, "/v1/buckets/"+m.Name.ValueString(), nil, &b); err != nil {
		if client.IsNotFound(err) {
			res.State.RemoveResource(ctx)
			return
		}
		res.Diagnostics.AddError("Reading bucket", err.Error())
		return
	}
	r.apply(&m, &b)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *bucketResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var plan bucketModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if res.Diagnostics.HasError() {
		return
	}
	var b client.Bucket
	if err := r.c.Do(ctx, http.MethodPatch, "/v1/buckets/"+plan.Name.ValueString(), map[string]interface{}{"public": plan.Public.ValueBool()}, &b); err != nil {
		res.Diagnostics.AddError("Updating bucket", err.Error())
		return
	}
	r.apply(&plan, &b)
	res.Diagnostics.Append(res.State.Set(ctx, &plan)...)
}

func (r *bucketResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m bucketModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/buckets/"+m.Name.ValueString(), nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Deleting bucket", err.Error())
	}
}

func (r *bucketResource) ImportState(ctx context.Context, req resource.ImportStateRequest, res *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("name"), req, res)
}

// ---- prgd_storage_key ----

type storageKeyResource struct{ c *client.Client }

type storageKeyModel struct {
	ID        types.String `tfsdk:"id"`
	Name      types.String `tfsdk:"name"`
	AccessKey types.String `tfsdk:"access_key"`
	SecretKey types.String `tfsdk:"secret_key"`
	Endpoint  types.String `tfsdk:"endpoint"`
}

func NewStorageKeyResource() resource.Resource { return &storageKeyResource{} }

func (r *storageKeyResource) Metadata(_ context.Context, req resource.MetadataRequest, res *resource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_storage_key"
}

func (r *storageKeyResource) Schema(_ context.Context, _ resource.SchemaRequest, res *resource.SchemaResponse) {
	computed := []planmodifier.String{stringplanmodifier.UseStateForUnknown()}
	res.Schema = schema.Schema{
		Description: "An S3 access key pair for every bucket in the project. The secret is only known at creation and stays in state; treat the state as sensitive.",
		Attributes: map[string]schema.Attribute{
			"id":         schema.StringAttribute{Computed: true, PlanModifiers: computed},
			"name":       schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"access_key": schema.StringAttribute{Computed: true, PlanModifiers: computed},
			"secret_key": schema.StringAttribute{Computed: true, Sensitive: true, PlanModifiers: computed},
			"endpoint":   schema.StringAttribute{Computed: true, PlanModifiers: computed},
		},
	}
}

func (r *storageKeyResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.c = clientFrom(req.ProviderData)
	}
}

func (r *storageKeyResource) Create(ctx context.Context, req resource.CreateRequest, res *resource.CreateResponse) {
	var m storageKeyModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var k struct {
		ID        string `json:"id"`
		AccessKey string `json:"accessKey"`
		SecretKey string `json:"secretKey"`
		Endpoint  string `json:"endpoint"`
	}
	if err := r.c.Do(ctx, http.MethodPost, "/v1/storage-keys", map[string]string{"name": m.Name.ValueString()}, &k); err != nil {
		res.Diagnostics.AddError("Creating storage key", err.Error())
		return
	}
	m.ID, m.AccessKey, m.SecretKey, m.Endpoint = types.StringValue(k.ID), types.StringValue(k.AccessKey), types.StringValue(k.SecretKey), types.StringValue(k.Endpoint)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *storageKeyResource) Read(ctx context.Context, req resource.ReadRequest, res *resource.ReadResponse) {
	var m storageKeyModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	var list struct {
		Data []struct {
			ID        string `json:"id"`
			AccessKey string `json:"accessKey"`
		} `json:"data"`
	}
	if err := r.c.Do(ctx, http.MethodGet, "/v1/storage-keys", nil, &list); err != nil {
		res.Diagnostics.AddError("Reading storage keys", err.Error())
		return
	}
	for _, k := range list.Data {
		if k.ID == m.ID.ValueString() {
			res.Diagnostics.Append(res.State.Set(ctx, &m)...)
			return
		}
	}
	res.State.RemoveResource(ctx)
}

func (r *storageKeyResource) Update(ctx context.Context, req resource.UpdateRequest, res *resource.UpdateResponse) {
	var m storageKeyModel
	res.Diagnostics.Append(req.Plan.Get(ctx, &m)...)
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

func (r *storageKeyResource) Delete(ctx context.Context, req resource.DeleteRequest, res *resource.DeleteResponse) {
	var m storageKeyModel
	res.Diagnostics.Append(req.State.Get(ctx, &m)...)
	if err := r.c.Do(ctx, http.MethodDelete, "/v1/storage-keys/"+m.ID.ValueString(), nil, nil); err != nil && !client.IsNotFound(err) {
		res.Diagnostics.AddError("Revoking storage key", err.Error())
	}
}
