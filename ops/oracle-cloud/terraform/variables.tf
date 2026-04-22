variable "region" {
  type = string
}

variable "tenancy_ocid" {
  type = string
}

variable "compartment_ocid" {
  type = string
}

variable "user_ocid" {
  type = string
}

variable "fingerprint" {
  type = string
}

variable "private_key_path" {
  type = string
}

variable "private_key_password" {
  type      = string
  default   = null
  sensitive = true
}

variable "availability_domain" {
  type    = string
  default = null
}

variable "ssh_public_key" {
  type = string
}

variable "instance_display_name" {
  type    = string
  default = "family-app-vm"
}

variable "shape" {
  type    = string
  default = "VM.Standard.A1.Flex"
}

variable "shape_ocpus" {
  type    = number
  default = 2
}

variable "shape_memory_gb" {
  type    = number
  default = 12
}

variable "boot_volume_size_gb" {
  type    = number
  default = 100
}

variable "subnet_cidr" {
  type    = string
  default = "10.0.1.0/24"
}

variable "vcn_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "api_port" {
  type    = number
  default = 4000
}

variable "image_ocid" {
  type        = string
  description = "Region-specific Ubuntu image OCID for ARM/A1. Oracle recommends pinning image OCIDs."
}

variable "repo_url" {
  type    = string
  default = "https://github.com/Stepanda1/Family-App.git"
}

variable "repo_branch" {
  type    = string
  default = "main"
}
