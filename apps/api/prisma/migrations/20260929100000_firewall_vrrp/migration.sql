-- Firewall rules for keepalived: VRRP is IP protocol 112 and has no ports.
ALTER TYPE "FirewallProtocol" ADD VALUE 'vrrp';
