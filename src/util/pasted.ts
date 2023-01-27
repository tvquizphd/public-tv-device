import { fromB64urlQuery, toB64urlQuery } from "sock-secret";
import { hasEncryptionKeys, decryptSecret } from "./decrypt.js";
import { toSign, isInstallation } from "../create.js";
import { request } from "@octokit/request";
import { isTrio } from "./types.js";
import path from 'node:path';
import fs from 'fs'

import type { ClientOut, NewClientOut } from "opaque-low-io";
import type { Secrets } from "./encrypt.js";
import type { TreeAny, NodeAny } from "sock-secret"
import type { UserInstallRaw } from "../create.js";
import type { UserInstall } from "../create.js";
import type { AppOutput } from "../create.js";
import type { Git, Trio } from "./types.js";

export type HasGit = { git: Git }
export type DevConfig = {
  home: string,
  tmp: string
}
export type UserIn = HasGit & {
  delay: number,
  prod: boolean,
  dev_config: DevConfig
}
type InstallIn = HasGit & {
  delay: number,
  app: AppOutput
}
type ItemInC = {
  "body": Uint8Array,
  "mac_tag": Uint8Array
}
type ServerAuthData = {
  As: Uint8Array,
  Xs: Uint8Array,
  beta: Uint8Array,
  c: Record<"pu" | "Pu" | "Ps", ItemInC>
}
export type Pasted = {
  C: Secrets,
  S?: ServerAuthData
}
export type UserApp = Pasted & {
  S: ServerAuthData
}
type DevInboxIn = {
  user_in: UserIn,
  inst: string,
  sec: Trio
}
interface ToUserInstall {
  (u: InstallIn): Promise<Obj>;
}
interface ReadUserInstall {
  (u: InstallIn): Promise<UserInstall>;
}
interface ReadUserApp {
  (u: UserIn): Promise<UserApp>;
}
interface ReadInbox {
  (u: DevInboxIn): Promise<Trio>;
}
interface ReadLoginStart {
  (u: UserIn): Promise<boolean>;
}
interface ReadLoginEnd {
  (u: UserIn): Promise<boolean>;
}
type Tries = {
  max_tries: number,
  dt: number
}
interface ToTries {
  (u: number): Tries; 
}
interface ToIssueText {
  (s: UserIn) : Promise<string>;
}
interface ToPastedText {
  (s: UserIn) : Promise<string>;
}
interface UseTempFile {
  (i: DevConfig): string; 
}
type Obj = Record<string, unknown>;

export type NameTree = {
  command: string,
  tree: TreeAny
} 
interface ToNameTree {
  (t: string): NameTree;
}
interface FromNameTree {
  (t: NameTree): string;
}

function isObj(u: unknown): u is Obj {
  return u != null && typeof u === "object";
}
function isTree(u: NodeAny): u is TreeAny {
  return u != null && typeof u === "object";
}

function hasCode(o: TreeAny): o is Pasted {
  if (!isTree(o.C)) {
    return false;
  }
  const { salt, key, data } = o.C;
  if (!isTree(key) || !isTree(data)) {
    return false;
  }
  const needs = [
    data.iv, data.tag, data.ev,
    salt, key.iv, key.tag, key.ev
  ];
  return needs.every(v => v instanceof Uint8Array);
}

function isForInstall(o: Obj): o is UserInstallRaw {
  if (!isObj(o)) {
    return false;
  }
  const needs = [
    typeof o.id === "number",
    isObj(o.permissions)
  ];
  return needs.every(v => v);
}

export type LoginStart = {
  client_auth_data: NewClientOut["client_auth_data"]
}
function isLoginStart (nt: TreeAny): nt is LoginStart {
  const o = (nt as LoginStart).client_auth_data || "";
  if (!isTree(o)) return false;
  const needs = [
    typeof o.sid === "string",
    o.pw instanceof Uint8Array,
    o.Xu instanceof Uint8Array,
    o.alpha instanceof Uint8Array,
  ]
  return needs.every(v => v);
}

export type LoginEnd = {
  client_auth_result: ClientOut["client_auth_result"]
}
function isLoginEnd(nt: TreeAny): nt is LoginEnd {
  const o = (nt as LoginEnd).client_auth_result || "";
  if (!isTree(o)) return false;
  return o.Au instanceof Uint8Array;
}

const useTempFile: UseTempFile = (dev_config) => {
  const { tmp, home } = dev_config;
  const tmp_dir = path.relative(process.cwd(), tmp);
  return path.join(tmp_dir, home);
}

const toIssueText: ToIssueText = async (user_in) => {
  const { repo, owner, owner_token } = user_in.git;
  const api_root = "https://api.github.com";
  const query = `?creator=${owner}&state=open`;
  const authorization = 'bearer ' + owner_token;
  const api_url = `${api_root}/repos/{owner}/{repo}/issues${query}`;
  const out = await request(`GET ${api_url}`, {
    owner, repo, headers: { authorization }
  });
  if (out.data.length >= 1) {
    return out.data[0].body || "";
  }
  return "";
}

const toPastedText: ToPastedText = async (user_in) => {
  if (user_in.prod) {
    const txt = await toIssueText(user_in);
    return txt.replaceAll('\n', '');
  }
  const encoding = 'utf-8';
  const { dev_config } = user_in;
  const src = useTempFile(dev_config);
  const txt = fs.readFileSync(src, { encoding });
  return txt.replaceAll('\n', '');
}

function isForApp(o: Pasted): o is UserApp {
  const d = o?.S;
  if (!d || !isTree(d)) {
    return false;
  }
  if (!isTree(d.c)) {
    return false;
  }
  if (!isTree(d.c.pu) || !isTree(d.c.Pu) || !isTree(d.c.Ps)) {
    return false;
  }
  const needs = [
    d.beta, d.Xs, d.As,
    d.c.pu.body, d.c.Pu.body, d.c.Ps.body,
    d.c.pu.mac_tag, d.c.Pu.mac_tag, d.c.Ps.mac_tag
  ];
  return needs.every(v => v instanceof Uint8Array);
}

const toTries: ToTries = (delay) => {
  const min15 = 60 * 15;
  const dt = delay * 1000;
  const max_tries = min15 / delay;
  return { dt, max_tries };
}

const toBytes = (s: string) => {
  const a: string[] = s.match(/../g) || [];
  const bytes = a.map(h =>parseInt(h,16)); 
  return new Uint8Array(bytes);
}

const toInstallation = (inst: string) => {
  const ins_value = process.env[inst] || "";
  const ins_obj = fromB64urlQuery(ins_value);
  if (!isInstallation(ins_obj)) {
    throw new Error(`Secret ${inst} invalid.`);
  }
  return ins_obj;
}

const readInbox: ReadInbox = async (inputs) => {
  const { user_in, inst, sec } = inputs;
  if (!user_in.prod) {
    return sec.map((k: string) => {
      return process.env[k] || "";
    }) as Trio;
  }
  const { shared } = toInstallation(inst);
  const key = toBytes(shared);
  try {
    const text = process.env["MAIL__TABLE"];
    const tree = fromB64urlQuery(text || "");
    const data = tree.data || "";
    if (hasEncryptionKeys(data)) {
      const out = decryptSecret({ data, key });
      const plain_text = new TextDecoder().decode(out);
      const trio = plain_text.split("\n");
      if (isTrio(trio)) {
        return trio;
      }
    }
    else {
      console.log('Missing dev inbox');
    }
  }
  catch {
    console.log('No passwords in dev inbox');
  }
  return ["", "", ""];
}

const readDevInbox: ReadInbox = async (inputs) => {
  const { user_in, inst, sec } = inputs;
  if (user_in.prod) {
    const { home } = user_in.dev_config;
    throw new Error(`Data only in ${home} during development`);
  }
  const { shared } = toInstallation(inst);
  const key = toBytes(shared);
  try {
    const text = await toPastedText(user_in);
    const { command, tree } = toNameTree(text);
    const ok_command = command === "mail__table";
    const data = tree.data || "";
    if (ok_command && hasEncryptionKeys(data)) {
      const out = decryptSecret({ data, key });
      const plain_text = new TextDecoder().decode(out);
      const trio = plain_text.split("\n");
      if (isTrio(trio)) {
        sec.map((k: string, i: number) => {
          process.env[k] = trio[i];
        });
        return trio;
      }
    }
    else {
      console.log('Missing dev inbox');
    }
  }
  catch {
    console.log('No passwords in dev inbox');
  }
  return ["", "", ""];
}

const readLoginStart: ReadLoginStart = async (ins) => {
  const { dt, max_tries } = toTries(ins.delay);
  if (ins.prod) {
    const { home } = ins.dev_config;
    throw new Error(`Data only in ${home} during development`);
  }
  let tries = 0;
  while (tries < Math.ceil(max_tries)) {
    await new Promise(r => setTimeout(r, dt));
    const text = await toPastedText(ins);
    if (isLoginStart(toNameTree(text).tree)) {
      return true;
    }
    tries += 1;
  }
  throw new Error("Timeout waiting for GitHub App");
}

const readLoginEnd: ReadLoginEnd = async (ins) => {
  const { dt, max_tries } = toTries(ins.delay);
  if (ins.prod) {
    const { home } = ins.dev_config;
    throw new Error(`Data only in ${home} during development`);
  }
  let tries = 0;
  while (tries < Math.ceil(max_tries)) {
    await new Promise(r => setTimeout(r, dt));
    const text = await toPastedText(ins);
    const { tree } = toNameTree(text);
    if (isLoginEnd(tree)) {
      return true;
    }
    tries += 1;
  }
  throw new Error("Timeout waiting for GitHub App");
}

const readUserApp: ReadUserApp = async (ins) => {
  const { dt, max_tries } = toTries(ins.delay);
  let tries = 0;
  while (tries < Math.ceil(max_tries)) {
    await new Promise(r => setTimeout(r, dt));
    const text = await toPastedText(ins);
    const pasted = fromB64urlQuery(text);
    if (hasCode(pasted) && isForApp(pasted)) {
      return pasted;
    }
    tries += 1;
  }
  throw new Error("Timeout waiting for GitHub App");
}


const toUserInstall: ToUserInstall = async (ins) => {
  const authorization = 'bearer ' + toSign(ins.app);
  const api_url = '/users/{username}/installation';
  const out = await request(`GET ${api_url}`, {
    username: ins.git.owner,
    headers: { authorization }
  })
  return out.data;
}

const readUserInstall: ReadUserInstall = async (ins) => {
  const { dt, max_tries } = toTries(ins.delay);
  console.log('Awaiting app installation...');
  let tries = 0;
  while (tries < Math.ceil(max_tries)) {
    await new Promise(r => setTimeout(r, dt));
    let install: Obj = {};
    try {
      install = await toUserInstall(ins);
    }
    catch (e: any) {
      if (e?.status !== 404) {
        console.error(e?.message);
        throw new Error("Error getting user installation");
      }
    }
    if (isForInstall(install)) {
      return {
        git: ins.git,
        app: ins.app,
        id: install.id,
        permissions: install.permissions
      };
    }
    tries += 1;
  }
  throw new Error("Timeout waiting for installation");
}

const toNameTree: ToNameTree = (s) => {
  const trio = s.split(/(#.*)/s);
  if (!s.length) {
    return { command: "", tree: {} }
  }
  if (!isTrio(trio)) {
    throw new Error('Poorly formatted workflow inputs');
  }
  const [command, rest] = trio;
  const tree = fromB64urlQuery(rest);
  return { command, tree };
}

const fromNameTree: FromNameTree = ({ command, tree }) => {
  return command + toB64urlQuery(tree);
}

export { 
  readUserApp, readUserInstall, toTries,
  isTree, isLoginStart, isLoginEnd, toNameTree, fromNameTree,
  readLoginStart, readLoginEnd, isObj, readDevInbox, toBytes,
  toInstallation, readInbox
}
