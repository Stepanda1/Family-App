variable "service_account_key_file" {
  type = string
}

variable "cloud_id" {
  type = string
}

variable "folder_id" {
  type = string
}

variable "zone" {
  type    = string
  default = "ru-central1-a"
}

variable "instance_name" {
  type    = string
  default = "family-app-vm"
}

variable "cores" {
  type    = number
  default = 2
}

variable "memory_gb" {
  type    = number
  default = 4
}

variable "core_fraction" {
  type    = number
  default = 20
}

variable "boot_disk_size_gb" {
  type    = number
  default = 40
}

variable "boot_disk_type" {
  type    = string
  default = "network-ssd"
}

variable "image_id" {
  type        = string
  description = "Ubuntu image ID in Yandex Cloud for the selected zone."
}

variable "subnet_cidr" {
  type    = string
  default = "10.10.0.0/24"
}

variable "api_port" {
  type    = number
  default = 4000
}

variable "ssh_user" {
  type    = string
  default = "ubuntu"
}

variable "ssh_public_key" {
  type = string
}

variable "repo_url" {
  type    = string
  default = "https://github.com/Stepanda1/Family-App.git"
}

variable "repo_branch" {
  type    = string
  default = "main"
}
