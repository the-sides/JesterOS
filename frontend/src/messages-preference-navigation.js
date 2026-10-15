// These are transient views of the one canonical Messages preferences record.
export function messagePreferencePanes(profile) {
  if (profile.family === 'windows') return [
    { id: 'general', label: 'General' }, { id: 'appearance', label: 'Appearance' },
    { id: 'notifications', label: 'Notifications' }, { id: 'account', label: 'Privacy' },
  ];
  const classic = ['high-sierra', 'mojave'].includes(profile.renderer);
  return [{ id: 'general', label: 'General' },
    { id: 'account', label: profile.renderer === 'high-sierra' ? 'Accounts' : 'iMessage' },
    ...(!classic ? [{ id: 'sharing', label: 'Shared with You' }] : [])];
}
