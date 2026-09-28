import { describe, expect, it } from 'vitest';
import { decideLink, emailTrusted, issuerValid, MS_PERSONAL_TENANT, safeReturnPath } from './linking';

const WORK_TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const MS_TEMPLATE = 'https://login.microsoftonline.com/{tenantid}/v2.0';

describe('emailTrusted', () => {
  it('trusts Google only when email_verified is true', () => {
    expect(emailTrusted('google', { email: 'a@b.sa', email_verified: true })).toBe(true);
    expect(emailTrusted('google', { email: 'a@b.sa', email_verified: 'true' })).toBe(true);
    expect(emailTrusted('google', { email: 'a@b.sa', email_verified: false })).toBe(false);
    expect(emailTrusted('google', { email: 'a@b.sa' })).toBe(false);
    expect(emailTrusted('google', { email_verified: true })).toBe(false);
  });

  it('trusts Microsoft personal accounts and verified domains, nothing else', () => {
    expect(emailTrusted('microsoft', { email: 'a@outlook.com', tid: MS_PERSONAL_TENANT })).toBe(true);
    expect(emailTrusted('microsoft', { email: 'a@contoso.com', tid: WORK_TENANT, xms_edov: true })).toBe(true);
    expect(emailTrusted('microsoft', { email: 'a@contoso.com', tid: WORK_TENANT })).toBe(false);
    expect(emailTrusted('microsoft', { email: 'a@contoso.com', tid: WORK_TENANT, xms_edov: false })).toBe(false);
    // email_verified means nothing for Microsoft; preferred_username is not an email claim.
    expect(emailTrusted('microsoft', { email: 'a@contoso.com', tid: WORK_TENANT, email_verified: true })).toBe(false);
    expect(emailTrusted('microsoft', { preferred_username: 'a@outlook.com', tid: MS_PERSONAL_TENANT })).toBe(false);
  });
});

describe('decideLink', () => {
  const verified = { email: 'a@b.sa', emailVerified: true };
  const unverified = { email: 'a@b.sa', emailVerified: false };

  it('(a) signs in the user an identity is already linked to, whatever the email says', () => {
    expect(decideLink({ intent: 'login', account: unverified, linkedUserId: 'u1', emailUserId: 'u2' })).toEqual({ action: 'sign_in', userId: 'u1' });
    expect(decideLink({ intent: 'signup', account: verified, linkedUserId: 'u1', emailUserId: null })).toEqual({ action: 'sign_in', userId: 'u1' });
  });

  it('(b) links to an existing user with the same email only when the provider vouches for it', () => {
    expect(decideLink({ intent: 'login', account: verified, linkedUserId: null, emailUserId: 'u2' })).toEqual({ action: 'link_and_sign_in', userId: 'u2' });
    expect(decideLink({ intent: 'login', account: unverified, linkedUserId: null, emailUserId: 'u2' })).toEqual({ action: 'refuse', code: 'link_from_security' });
    expect(decideLink({ intent: 'signup', account: unverified, linkedUserId: null, emailUserId: 'u2' })).toEqual({ action: 'refuse', code: 'link_from_security' });
  });

  it('(c) creates an account when nobody has the address, and refuses without an address', () => {
    expect(decideLink({ intent: 'login', account: verified, linkedUserId: null, emailUserId: null })).toEqual({ action: 'create' });
    expect(decideLink({ intent: 'login', account: unverified, linkedUserId: null, emailUserId: null })).toEqual({ action: 'create' });
    expect(decideLink({ intent: 'login', account: { email: null, emailVerified: false }, linkedUserId: null, emailUserId: null })).toEqual({ action: 'refuse', code: 'email_missing' });
  });

  it('links from Security to the signed in user, never taking an identity from someone else', () => {
    expect(decideLink({ intent: 'link', account: unverified, linkedUserId: null, emailUserId: 'u9', currentUserId: 'u1' })).toEqual({ action: 'link', userId: 'u1' });
    expect(decideLink({ intent: 'link', account: verified, linkedUserId: 'u1', emailUserId: null, currentUserId: 'u1' })).toEqual({ action: 'already_linked', userId: 'u1' });
    expect(decideLink({ intent: 'link', account: verified, linkedUserId: 'u2', emailUserId: null, currentUserId: 'u1' })).toEqual({ action: 'refuse', code: 'identity_in_use' });
    expect(decideLink({ intent: 'link', account: verified, linkedUserId: null, emailUserId: null, currentUserId: null })).toEqual({ action: 'refuse', code: 'link_session_invalid' });
  });
});

describe('issuerValid', () => {
  it('accepts Google with or without the scheme and nothing else', () => {
    const d = 'https://accounts.google.com';
    expect(issuerValid('google', d, { iss: 'https://accounts.google.com' })).toBe(true);
    expect(issuerValid('google', d, { iss: 'accounts.google.com' })).toBe(true);
    expect(issuerValid('google', d, { iss: 'https://evil.example' })).toBe(false);
    expect(issuerValid('google', d, {})).toBe(false);
  });

  it('fills the Microsoft common template with the token tid', () => {
    expect(issuerValid('microsoft', MS_TEMPLATE, { iss: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0`, tid: WORK_TENANT })).toBe(true);
    expect(issuerValid('microsoft', MS_TEMPLATE, { iss: `https://login.microsoftonline.com/${MS_PERSONAL_TENANT}/v2.0`, tid: MS_PERSONAL_TENANT })).toBe(true);
  });

  it('refuses a Microsoft token whose issuer and tid disagree or whose tid is malformed', () => {
    expect(issuerValid('microsoft', MS_TEMPLATE, { iss: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0`, tid: MS_PERSONAL_TENANT })).toBe(false);
    expect(issuerValid('microsoft', MS_TEMPLATE, { iss: 'https://login.microsoftonline.com/{tenantid}/v2.0', tid: WORK_TENANT })).toBe(false);
    expect(issuerValid('microsoft', MS_TEMPLATE, { iss: 'https://login.microsoftonline.com/x/v2.0', tid: 'x' })).toBe(false);
    expect(issuerValid('microsoft', MS_TEMPLATE, { iss: `https://sts.windows.net/${WORK_TENANT}/`, tid: WORK_TENANT })).toBe(false);
    expect(issuerValid('microsoft', MS_TEMPLATE, { iss: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0` })).toBe(false);
  });

  it('applies the configured tenant', () => {
    const work = { iss: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0`, tid: WORK_TENANT };
    const personal = { iss: `https://login.microsoftonline.com/${MS_PERSONAL_TENANT}/v2.0`, tid: MS_PERSONAL_TENANT };
    expect(issuerValid('microsoft', MS_TEMPLATE, work, 'consumers')).toBe(false);
    expect(issuerValid('microsoft', MS_TEMPLATE, personal, 'consumers')).toBe(true);
    expect(issuerValid('microsoft', MS_TEMPLATE, personal, 'organizations')).toBe(false);
    expect(issuerValid('microsoft', MS_TEMPLATE, work, 'organizations')).toBe(true);
    const single = `https://login.microsoftonline.com/${WORK_TENANT}/v2.0`;
    expect(issuerValid('microsoft', single, work, WORK_TENANT)).toBe(true);
    expect(issuerValid('microsoft', single, { ...personal }, WORK_TENANT)).toBe(false);
  });
});

describe('safeReturnPath', () => {
  it('keeps console paths and drops anything that could leave the console', () => {
    expect(safeReturnPath('/servers/abc?tab=1')).toBe('/servers/abc?tab=1');
    expect(safeReturnPath('//evil.example')).toBe('/servers');
    expect(safeReturnPath('https://evil.example')).toBe('/servers');
    expect(safeReturnPath('/\\evil.example')).toBe('/servers');
    expect(safeReturnPath('/javascript:alert(1)')).toBe('/servers');
    expect(safeReturnPath(undefined, '/security')).toBe('/security');
  });
});
