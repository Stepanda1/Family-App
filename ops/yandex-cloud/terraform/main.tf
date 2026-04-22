locals {
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    ssh_user       = var.ssh_user
    ssh_public_key = var.ssh_public_key
    repo_url       = var.repo_url
    repo_branch    = var.repo_branch
  })
}

resource "yandex_vpc_network" "family_app" {
  name = "family-app-network"
}

resource "yandex_vpc_subnet" "family_app" {
  name           = "family-app-subnet"
  zone           = var.zone
  network_id     = yandex_vpc_network.family_app.id
  v4_cidr_blocks = [var.subnet_cidr]
}

resource "yandex_vpc_security_group" "family_app" {
  name       = "family-app-sg"
  network_id = yandex_vpc_network.family_app.id

  ingress {
    description    = "SSH"
    protocol       = "TCP"
    port           = 22
    v4_cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description    = "Family App API"
    protocol       = "TCP"
    port           = var.api_port
    v4_cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description    = "Outbound"
    protocol       = "ANY"
    from_port      = 0
    to_port        = 65535
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "yandex_compute_instance" "family_app" {
  name        = var.instance_name
  hostname    = var.instance_name
  zone        = var.zone
  platform_id = "standard-v3"

  resources {
    cores         = var.cores
    memory        = var.memory_gb
    core_fraction = var.core_fraction
  }

  boot_disk {
    initialize_params {
      image_id = var.image_id
      size     = var.boot_disk_size_gb
      type     = var.boot_disk_type
    }
  }

  network_interface {
    subnet_id          = yandex_vpc_subnet.family_app.id
    nat                = true
    security_group_ids = [yandex_vpc_security_group.family_app.id]
  }

  metadata = {
    user-data = local.user_data
  }
}
