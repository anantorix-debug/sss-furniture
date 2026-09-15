// Kept separate from orderMessages.ts - shares no logic with order
// confirmation messages. roleLabel is passed in rather than importing
// ROLE_LABEL (which lives locally in users/page.tsx) so this stays a
// plain lib module with no dependency on an app/ page file.
export function buildCredentialsMessage(
  user: { name: string; email: string },
  roleLabel: string,
  temporaryPassword: string,
): string {
  return [
    `Hi ${user.name},`,
    ``,
    `Here are your login credentials for the ERP system:`,
    ``,
    `Login Email: ${user.email}`,
    `Password: ${temporaryPassword}`,
    `Role: ${roleLabel}`,
    ``,
    `Please log in and change your password as soon as possible.`,
  ].join('\n');
}
