// Package provider implements the prgd Terraform provider on terraform-plugin-framework.
package provider

import (
	"context"
	"os"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/prgd/terraform-provider-prgd/internal/client"
)

type prgdProvider struct{ version string }

type providerModel struct {
	Token  types.String `tfsdk:"token"`
	APIURL types.String `tfsdk:"api_url"`
}

func New(version string) func() provider.Provider {
	return func() provider.Provider { return &prgdProvider{version: version} }
}

func (p *prgdProvider) Metadata(_ context.Context, _ provider.MetadataRequest, res *provider.MetadataResponse) {
	res.TypeName = "prgd"
	res.Version = p.version
}

func (p *prgdProvider) Schema(_ context.Context, _ provider.SchemaRequest, res *provider.SchemaResponse) {
	res.Schema = schema.Schema{
		Description: "Manage prgd servers, firewalls and SSH keys. Create an API token under Managed Agents, Agent Access.",
		Attributes: map[string]schema.Attribute{
			"token":   schema.StringAttribute{Optional: true, Sensitive: true, Description: "API token (prgd_...). Defaults to PRGD_TOKEN."},
			"api_url": schema.StringAttribute{Optional: true, Description: "API base URL. Defaults to PRGD_API_URL or https://api.prgd.example."},
		},
	}
}

func (p *prgdProvider) Configure(ctx context.Context, req provider.ConfigureRequest, res *provider.ConfigureResponse) {
	var m providerModel
	res.Diagnostics.Append(req.Config.Get(ctx, &m)...)
	if res.Diagnostics.HasError() {
		return
	}
	token := m.Token.ValueString()
	if token == "" {
		token = os.Getenv("PRGD_TOKEN")
	}
	if token == "" {
		res.Diagnostics.AddError("Missing token", "Set provider token or the PRGD_TOKEN environment variable.")
		return
	}
	url := m.APIURL.ValueString()
	if url == "" {
		url = os.Getenv("PRGD_API_URL")
	}
	if url == "" {
		url = "https://api.prgd.example"
	}
	c := client.New(url, token)
	res.ResourceData = c
	res.DataSourceData = c
}

func (p *prgdProvider) Resources(_ context.Context) []func() resource.Resource {
	return []func() resource.Resource{NewServerResource, NewVolumeResource, NewLoadBalancerResource, NewDomainResource, NewDnsRecordResource, NewBucketResource, NewStorageKeyResource, NewDatabaseResource, NewKubernetesResource, NewAppResource, NewFirewallResource, NewSshKeyResource}
}

func (p *prgdProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{NewSizesDataSource, NewImagesDataSource}
}

// clientFrom pulls the configured client out of the request; nil with a diagnostic if missing.
func clientFrom(data any) *client.Client {
	c, _ := data.(*client.Client)
	return c
}
