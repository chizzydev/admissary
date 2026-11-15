declare module "node:crypto" {
  export interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: "hex"): string;
  }

  export interface KeyObject {
    asymmetricKeyType: string;
    export(options: {
      type: "spki" | "pkcs8";
      format: "pem";
    }): string | Uint8Array;
  }

  export function createHash(algorithm: string): Hash;

  export function createPrivateKey(key: string): KeyObject;
  export function createPublicKey(key: string | KeyObject): KeyObject;

  export function generateKeyPairSync(
    type: "ed25519",
  ): {
    publicKey: KeyObject;
    privateKey: KeyObject;
  };

  export function sign(
    algorithm: null,
    data: Uint8Array,
    key: string | KeyObject,
  ): Uint8Array;

  export function verify(
    algorithm: null,
    data: Uint8Array,
    key: string | KeyObject,
    signature: Uint8Array,
  ): boolean;
}


declare module "node:fs/promises" {
  export function mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<string | undefined>;

  export function readFile(
    path: string,
    encoding: "utf8",
  ): Promise<string>;

  export function writeFile(
    path: string,
    data: string,
    encoding: "utf8",
  ): Promise<void>;

  export function rename(
    oldPath: string,
    newPath: string,
  ): Promise<void>;

  export function unlink(
    path: string,
  ): Promise<void>;
}

declare module "node:path" {
  export function dirname(path: string): string;
}

declare module "node:fs/promises" {
  export function open(path: string, flags: string): Promise<{ close(): Promise<void>; sync(): Promise<void>; writeFile(data: string): Promise<void> }>;
}

declare module "node:process" { export const pid: number; }
