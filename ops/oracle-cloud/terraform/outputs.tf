output "public_ip" {
  value = oci_core_instance.family_app.public_ip
}

output "instance_ocid" {
  value = oci_core_instance.family_app.id
}

output "availability_domain" {
  value = local.selected_ad
}
