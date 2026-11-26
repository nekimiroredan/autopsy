export const CONTACT_AVATARS: Record<string, string> = {
  'contact-rcv': '/src/assets/images/avatar_receiving_supervisor_1795602481262.jpg',
  'contact-whm': '/src/assets/images/avatar_warehouse_manager_1795602481288.jpg',
  'contact-shp': '/src/assets/images/avatar_shipping_lead_1795602482354.jpg',
};

export function getContactInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
