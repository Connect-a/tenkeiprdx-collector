export const b64ToBytes = (b64) => {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
};

export const latin1 = new TextDecoder('iso-8859-1');

export const num = (x) => (typeof x === 'bigint' ? Number(x) : x);
