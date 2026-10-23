import type { GraphRef, Settings } from './types';
import type { BusyInterval } from './engine';
import { toISODate } from './dates';
import type { MailSample } from './replyWindow';

export const GRAPH_SCOPES = ['User.Read', 'Mail.Read', 'Chat.ReadBasic', 'ChatMessage.Read', 'Calendars.Read'];
export const GRAPH_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
export const GRAPH_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';
export const GRAPH_MAIL_URL =
  'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=10&$filter=isRead%20eq%20false&$select=id,subject,from,receivedDateTime,bodyPreview,webLink';
export const GRAPH_CHAT_URL = 'https://graph.microsoft.com/v1.0/me/chats/getAllMessages?$top=30';

const TOKEN_KEY = 'mwp.graph.token';
const VERIFIER_KEY = 'mwp.graph.verifier';
const STATE_KEY = 'mwp.graph.state';
const CACHE_KEY = 'mwp.graph.cache';

export interface GraphToken {
  accessToken: string;
  expiresAt: number;
  scopes: string;
}

export interface GraphAccount {
  displayName: string;
  mail: string;
}

export interface GraphHighlight {
  id: string;
  kind: 'mail' | 'chat';
  title: string;
  from: string;
  preview: string;
  receivedAt: string;
  webUrl: string;
  ref: GraphRef;
}

export interface GraphCache {
  fetchedAt: string;
  items: GraphHighlight[];
}

export interface GraphFetchResult {
  items: GraphHighlight[];
  errors: string[];
  account: GraphAccount | null;
  fetchedAt: string;
}

export function isGraphConfigured(settings: Settings): boolean {
  return settings.graphClientId.trim().length > 0;
}

export function graphRedirectUri(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) };
}

export async function beginGraphSignIn(clientId: string): Promise<void> {
  const { verifier, challenge } = await createPkcePair();
  const state = randomString(24);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    response_type: 'code',
    redirect_uri: graphRedirectUri(),
    response_mode: 'query',
    scope: GRAPH_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  window.location.assign(`${GRAPH_AUTH_URL}?${params.toString()}`);
}

export function graphRedirectPending(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('code') || params.has('error');
}

export function cleanGraphRedirectUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  url.searchParams.delete('session_state');
  window.history.replaceState({}, '', url.toString());
}

export function loadGraphToken(): GraphToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const token = JSON.parse(raw) as GraphToken;
    if (!token.accessToken || token.expiresAt <= Date.now() + 60_000) {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function saveGraphToken(token: GraphToken): void {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function clearGraphToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(CACHE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

export function loadGraphCache(): GraphCache | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GraphCache;
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveGraphCache(cache: GraphCache): void {
  sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export async function completeGraphSignIn(clientId: string): Promise<GraphToken> {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  if (error) {
    throw new Error(params.get('error_description') || error);
  }
  const code = params.get('code');
  const returnedState = params.get('state');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!code) throw new Error('Microsoft sign-in did not return an authorization code.');
  if (!verifier) throw new Error('Sign-in session expired. Start the connection again.');
  if (returnedState && expectedState && returnedState !== expectedState) {
    throw new Error('Sign-in state did not match. Start the connection again for safety.');
  }

  const body = new URLSearchParams({
    client_id: clientId.trim(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: graphRedirectUri(),
    code_verifier: verifier,
    scope: GRAPH_SCOPES.join(' '),
  });

  const response = await fetch(GRAPH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Token exchange failed (${response.status}). ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number; scope?: string };
  if (!data.access_token) throw new Error('Microsoft did not return an access token.');
  const token: GraphToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scopes: data.scope ?? GRAPH_SCOPES.join(' '),
  };
  saveGraphToken(token);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return token;
}

export function describeGraphError(status: number, source: 'mail' | 'chat' | 'calendar', detail: string): string {
  if (status === 401) return 'Microsoft sign-in expired (401). Please reconnect in Settings.';
  if (status === 403) {
    if (source === 'chat') {
      return 'Teams chat read was refused (403) — your admin may need to grant consent for Chat.ReadBasic / ChatMessage.Read.';
    }
    if (source === 'calendar') {
      return 'Calendar read was refused (403) — reconnect Microsoft in Settings to grant the Calendars.Read scope (it was added after the first connection).';
    }
    return 'Mail read was refused (403) — your admin may need to grant Mail.Read consent.';
  }
  return `${source === 'mail' ? 'Mail' : source === 'calendar' ? 'Calendar' : 'Teams chat'} request failed (${status}). ${detail.slice(0, 200)}`;
}

async function graphGet<T>(url: string, token: GraphToken, source: 'mail' | 'chat' | 'calendar'): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(describeGraphError(response.status, source, detail));
  }
  return (await response.json()) as T;
}

function stripHtml(html: string): string {
  const withoutTags = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  return withoutTags.replace(/\s+/g, ' ').trim();
}

interface MailResponse {
  value?: Array<{
    id: string;
    subject?: string;
    receivedDateTime?: string;
    bodyPreview?: string;
    webLink?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
  }>;
}

interface ChatMessage {
  id: string;
  messageType?: string;
  createdDateTime?: string;
  webUrl?: string;
  body?: { content?: string; contentType?: string };
  from?: { user?: { displayName?: string } };
  mentions?: Array<{ mentionText?: string; mentioned?: { user?: { displayName?: string } } }>;
}

interface ChatResponse {
  value?: ChatMessage[];
}

export async function fetchGraphHighlights(token: GraphToken): Promise<GraphFetchResult> {
  const items: GraphHighlight[] = [];
  const errors: string[] = [];
  let account: GraphAccount | null = null;

  const results = await Promise.allSettled([
    graphGet<{ displayName?: string; mail?: string; userPrincipalName?: string }>(GRAPH_ME_URL, token, 'mail'),
    graphGet<MailResponse>(GRAPH_MAIL_URL, token, 'mail'),
    graphGet<ChatResponse>(GRAPH_CHAT_URL, token, 'chat'),
  ]);

  const me = results[0];
  if (me.status === 'fulfilled') {
    account = { displayName: me.value.displayName ?? '', mail: me.value.mail ?? me.value.userPrincipalName ?? '' };
  } else {
    errors.push(me.reason instanceof Error ? me.reason.message : 'Could not read your Microsoft profile.');
  }

  const mail = results[1];
  if (mail.status === 'fulfilled') {
    for (const message of mail.value.value ?? []) {
      const sender = message.from?.emailAddress?.name || message.from?.emailAddress?.address || 'Unknown sender';
      items.push({
        id: `mail_${message.id}`,
        kind: 'mail',
        title: message.subject || '(no subject)',
        from: sender,
        preview: (message.bodyPreview ?? '').slice(0, 240),
        receivedAt: message.receivedDateTime ?? new Date().toISOString(),
        webUrl: message.webLink ?? 'https://outlook.office.com/mail/',
        ref: { kind: 'mail', id: message.id, webUrl: message.webLink ?? 'https://outlook.office.com/mail/' },
      });
    }
  } else {
    errors.push(mail.reason instanceof Error ? mail.reason.message : 'Mail could not be read.');
  }

  const chats = results[2];
  if (chats.status === 'fulfilled') {
    for (const message of chats.value.value ?? []) {
      if (message.messageType && message.messageType !== 'message') continue;
      const mentions = message.mentions ?? [];
      const bodyText = stripHtml(message.body?.content ?? '');
      const name = account?.displayName ?? '';
      const mentioned =
        mentions.length > 0 ||
        (name.length > 0 && bodyText.toLowerCase().includes(name.toLowerCase()));
      if (!mentioned) continue;
      const sender = message.from?.user?.displayName || 'Teams';
      items.push({
        id: `chat_${message.id}`,
        kind: 'chat',
        title: `Teams mention from ${sender}`,
        from: sender,
        preview: bodyText.slice(0, 240),
        receivedAt: message.createdDateTime ?? new Date().toISOString(),
        webUrl: message.webUrl ?? 'https://teams.microsoft.com/',
        ref: { kind: 'chat', id: message.id, webUrl: message.webUrl ?? 'https://teams.microsoft.com/' },
      });
    }
  } else {
    errors.push(chats.reason instanceof Error ? chats.reason.message : 'Teams chat could not be read.');
  }

  items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return { items, errors, account, fetchedAt: new Date().toISOString() };
}

/** One local day of calendarView, padded to UTC bounds Graph accepts. */
export function graphCalendarViewUrl(dateISO: string): string {
  const startUtc = `${dateISO}T00:00:00Z`;
  const parsed = new Date(`${dateISO}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  const pad = (value: number) => String(value).padStart(2, '0');
  const endUtc = `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}T00:00:00Z`;
  const params = new URLSearchParams({
    startDateTime: startUtc,
    endDateTime: endUtc,
    $top: '50',
    $select: 'id,subject,start,end,isAllDay,showAs',
  });
  return `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`;
}

/** Mail mentioning a client, newest first — for reply windows (#7). */
export function graphClientMailUrl(client: string): string {
  // OData string literals escape single quotes by doubling them.
  const safe = client.replace(/'/g, "''");
  const params = new URLSearchParams({
    $top: '25',
    $orderby: 'receivedDateTime desc',
    $select: 'id,subject,from,receivedDateTime',
    $filter: `contains(subject,'${safe}') or contains(from/emailAddress/name,'${safe}')`,
  });
  return `https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`;
}

interface ClientMailResponse {
  value?: Array<{
    subject?: string;
    receivedDateTime?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
  }>;
}

export interface ClientMailResult {
  messages: MailSample[];
  /** Honest failure text — never a silent empty list. */
  error: string | null;
}

/**
 * Best time to follow up (#7): the messages a client actually sent, so the
 * reply-window stats are theirs, not a guess. Never throws.
 */
export async function fetchClientMail(token: GraphToken, client: string): Promise<ClientMailResult> {
  try {
    const response = await fetch(graphClientMailUrl(client), {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      const detail = await response.text();
      return { messages: [], error: describeGraphError(response.status, 'mail', detail) };
    }
    const data = (await response.json()) as ClientMailResponse;
    const messages: MailSample[] = [];
    for (const message of data.value ?? []) {
      if (!message.receivedDateTime) continue;
      const at = new Date(message.receivedDateTime);
      if (Number.isNaN(at.getTime())) continue;
      messages.push({
        fromName: message.from?.emailAddress?.name ?? message.from?.emailAddress?.address ?? 'Unknown sender',
        fromAddress: message.from?.emailAddress?.address ?? '',
        receivedAt: at.toISOString(),
        subject: message.subject ?? '(no subject)',
      });
    }
    return { messages, error: null };
  } catch (error) {
    return {
      messages: [],
      error: error instanceof Error ? error.message : 'Could not reach Microsoft Graph for this client’s mail.',
    };
  }
}

interface CalendarResponse {
  value?: Array<{
    id?: string;
    subject?: string;
    isAllDay?: boolean;
    showAs?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
  }>;
}

export interface CalendarFetchResult {
  /** Timed, non-free events on `dateISO`, as minutes-of-day. */
  items: BusyInterval[];
  /** Honest failure text (scope, consent, network) — never a silent zero. */
  error: string | null;
  fetchedAt: string;
}

/**
 * Calendar truth (#10): today's meetings as busy intervals the scheduler must
 * not schedule into. Never throws — a missing scope yields a readable error
 * instead of pretending the day is free.
 */
export async function fetchDayMeetings(token: GraphToken, dateISO: string): Promise<CalendarFetchResult> {
  try {
    const response = await fetch(graphCalendarViewUrl(dateISO), {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      const detail = await response.text();
      return { items: [], error: describeGraphError(response.status, 'calendar', detail), fetchedAt: new Date().toISOString() };
    }
    const data = (await response.json()) as CalendarResponse;
    const items: BusyInterval[] = [];
    for (const event of data.value ?? []) {
      if (!event.start?.dateTime || !event.end?.dateTime) continue;
      if (event.isAllDay) continue; // an all-day banner is not a timed block
      if (event.showAs === 'free') continue;
      const start = new Date(event.start.dateTime);
      const end = new Date(event.end.dateTime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
      if (toISODate(start) !== dateISO) continue; // keep only this local day
      items.push({
        id: event.id ?? `evt_${start.getTime()}`,
        title: event.subject?.trim() || '(no subject)',
        start: start.getHours() * 60 + start.getMinutes(),
        end: end.getHours() * 60 + end.getMinutes(),
      });
    }
    items.sort((a, b) => a.start - b.start);
    return { items, error: null, fetchedAt: new Date().toISOString() };
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : 'Could not reach Microsoft Graph for your calendar.',
      fetchedAt: new Date().toISOString(),
    };
  }
}
