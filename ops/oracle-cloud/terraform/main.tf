locals {
  selected_ad = var.availability_domain != null ? var.availability_domain : data.oci_identity_availability_domains.ads.availability_domains[0].name
  user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
    repo_url    = var.repo_url
    repo_branch = var.repo_branch
  }))
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

resource "oci_core_vcn" "family_app" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "family-app-vcn"
  dns_label      = "familyapp"
}

resource "oci_core_internet_gateway" "family_app" {
  compartment_id = var.compartment_ocid
  display_name   = "family-app-igw"
  vcn_id         = oci_core_vcn.family_app.id
  enabled        = true
}

resource "oci_core_route_table" "family_app" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.family_app.id
  display_name   = "family-app-rt"

  route_rules {
    network_entity_id = oci_core_internet_gateway.family_app.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

resource "oci_core_security_list" "family_app" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.family_app.id
  display_name   = "family-app-sl"

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = var.api_port
      max = var.api_port
    }
  }
}

resource "oci_core_subnet" "family_app" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.family_app.id
  cidr_block                 = var.subnet_cidr
  display_name               = "family-app-subnet"
  dns_label                  = "public"
  route_table_id             = oci_core_route_table.family_app.id
  security_list_ids          = [oci_core_security_list.family_app.id]
  prohibit_public_ip_on_vnic = false
}

resource "oci_core_instance" "family_app" {
  compartment_id      = var.compartment_ocid
  availability_domain = local.selected_ad
  display_name        = var.instance_display_name
  shape               = var.shape

  shape_config {
    ocpus         = var.shape_ocpus
    memory_in_gbs = var.shape_memory_gb
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.family_app.id
    assign_public_ip = true
    display_name     = "family-app-vnic"
    hostname_label   = "familyapp"
  }

  source_details {
    source_type             = "image"
    source_id               = var.image_ocid
    boot_volume_size_in_gbs = var.boot_volume_size_gb
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = local.user_data
  }
}
