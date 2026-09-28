// terraform-provider-prgd: manage prgd servers, firewalls and SSH keys from Terraform
// or OpenTofu. Built on terraform-plugin-framework; talks to the same public API as the CLI.
package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"

	"github.com/prgd/terraform-provider-prgd/internal/provider"
)

var version = "dev"

func main() {
	debug := flag.Bool("debug", false, "run with debugger support")
	flag.Parse()
	err := providerserver.Serve(context.Background(), provider.New(version), providerserver.ServeOpts{
		Address: "registry.terraform.io/prgd/prgd",
		Debug:   *debug,
	})
	if err != nil {
		log.Fatal(err)
	}
}
