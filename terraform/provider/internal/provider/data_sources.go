package provider

import (
	"context"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/prgd/terraform-provider-prgd/internal/client"
)

// ---- prgd_sizes ----

type sizesDataSource struct{ c *client.Client }

type sizeModel struct {
	ID         types.String  `tfsdk:"id"`
	Vcpu       types.Int64   `tfsdk:"vcpu"`
	MemoryMb   types.Int64   `tfsdk:"memory_mb"`
	DiskGb     types.Int64   `tfsdk:"disk_gb"`
	TransferTb types.Float64 `tfsdk:"transfer_tb"`
}

type sizesModel struct {
	Sizes []sizeModel `tfsdk:"sizes"`
}

func NewSizesDataSource() datasource.DataSource { return &sizesDataSource{} }

func (d *sizesDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, res *datasource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_sizes"
}

func (d *sizesDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, res *datasource.SchemaResponse) {
	res.Schema = schema.Schema{
		Description: "Available server sizes.",
		Attributes: map[string]schema.Attribute{
			"sizes": schema.ListNestedAttribute{Computed: true, NestedObject: schema.NestedAttributeObject{Attributes: map[string]schema.Attribute{
				"id": schema.StringAttribute{Computed: true}, "vcpu": schema.Int64Attribute{Computed: true}, "memory_mb": schema.Int64Attribute{Computed: true},
				"disk_gb": schema.Int64Attribute{Computed: true}, "transfer_tb": schema.Float64Attribute{Computed: true},
			}}},
		},
	}
}

func (d *sizesDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, _ *datasource.ConfigureResponse) {
	if req.ProviderData != nil {
		d.c = clientFrom(req.ProviderData)
	}
}

func (d *sizesDataSource) Read(ctx context.Context, _ datasource.ReadRequest, res *datasource.ReadResponse) {
	var list struct {
		Data []client.Size `json:"data"`
	}
	if err := d.c.Do(ctx, http.MethodGet, "/v1/sizes", nil, &list); err != nil {
		res.Diagnostics.AddError("Reading sizes", err.Error())
		return
	}
	m := sizesModel{}
	for _, s := range list.Data {
		m.Sizes = append(m.Sizes, sizeModel{ID: types.StringValue(s.ID), Vcpu: types.Int64Value(s.Vcpu), MemoryMb: types.Int64Value(s.MemoryMb), DiskGb: types.Int64Value(s.DiskGb), TransferTb: types.Float64Value(s.TransferTb)})
	}
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}

// ---- prgd_images ----

type imagesDataSource struct{ c *client.Client }

type imageModel struct {
	ID   types.String `tfsdk:"id"`
	Kind types.String `tfsdk:"kind"`
	Name types.String `tfsdk:"name"`
}

type imagesModel struct {
	Kind   types.String `tfsdk:"kind"`
	Images []imageModel `tfsdk:"images"`
}

func NewImagesDataSource() datasource.DataSource { return &imagesDataSource{} }

func (d *imagesDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, res *datasource.MetadataResponse) {
	res.TypeName = req.ProviderTypeName + "_images"
}

func (d *imagesDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, res *datasource.SchemaResponse) {
	res.Schema = schema.Schema{
		Description: "Distribution images and marketplace apps.",
		Attributes: map[string]schema.Attribute{
			"kind": schema.StringAttribute{Optional: true, Description: "distribution or marketplace; both when unset."},
			"images": schema.ListNestedAttribute{Computed: true, NestedObject: schema.NestedAttributeObject{Attributes: map[string]schema.Attribute{
				"id": schema.StringAttribute{Computed: true}, "kind": schema.StringAttribute{Computed: true}, "name": schema.StringAttribute{Computed: true},
			}}},
		},
	}
}

func (d *imagesDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, _ *datasource.ConfigureResponse) {
	if req.ProviderData != nil {
		d.c = clientFrom(req.ProviderData)
	}
}

func (d *imagesDataSource) Read(ctx context.Context, req datasource.ReadRequest, res *datasource.ReadResponse) {
	var m imagesModel
	res.Diagnostics.Append(req.Config.Get(ctx, &m)...)
	path := "/v1/images"
	if !m.Kind.IsNull() && m.Kind.ValueString() != "" {
		path += "?kind=" + m.Kind.ValueString()
	}
	var list struct {
		Data []client.Image `json:"data"`
	}
	if err := d.c.Do(ctx, http.MethodGet, path, nil, &list); err != nil {
		res.Diagnostics.AddError("Reading images", err.Error())
		return
	}
	for _, i := range list.Data {
		m.Images = append(m.Images, imageModel{ID: types.StringValue(i.ID), Kind: types.StringValue(i.Kind), Name: types.StringValue(i.Name)})
	}
	res.Diagnostics.Append(res.State.Set(ctx, &m)...)
}
