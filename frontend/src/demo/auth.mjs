const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const recoveryKey = () =>
  hex(crypto.getRandomValues(new Uint8Array(12)))
    .toUpperCase()
    .match(/.{1,6}/g)
    .join("-");
export async function digest(secret, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode(salt),
        iterations: 120000,
        hash: "SHA-256",
      },
      key,
      256,
    ),
  );
}
export async function createCredential(password, recovery) {
  if (password.length < 8 || password.length > 128)
    throw Error(
      "Пароль: от 8 до 128 символов. Используйте отдельный тестовый пароль.",
    );
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const credential = { salt, hash: await digest(password, salt) };
  if (recovery) {
    const recoverySalt = hex(crypto.getRandomValues(new Uint8Array(16)));
    credential.recoverySalt = recoverySalt;
    credential.recoveryHash = await digest(
      recovery.trim().toUpperCase(),
      recoverySalt,
    );
  }
  return credential;
}
export async function verify(secret, auth, recovery = false) {
  if (!auth) return false;
  return (
    (await digest(
      recovery ? secret.trim().toUpperCase() : secret,
      recovery ? auth.recoverySalt : auth.salt,
    )) === (recovery ? auth.recoveryHash : auth.hash)
  );
}
