output "public_ip" {
  value = yandex_compute_instance.family_app.network_interface[0].nat_ip_address
}

output "internal_ip" {
  value = yandex_compute_instance.family_app.network_interface[0].ip_address
}

output "instance_id" {
  value = yandex_compute_instance.family_app.id
}
