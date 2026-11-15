// The student's account: Google sign-in and their data in Firestore (Firebase, Google's free tier).
// Everything lives under users/{uid}/, and the project's rules let a person read and write only
// their own folder. Firebase is loaded from Google's CDN only when someone signs in.
//   users/{uid}/sync/{section}         { json, at }  — one document per section of data
//   users/{uid}/state/{section}        the same, as pages from before 2026-11-12 read and write it: the
//                                      new code reads both places, joins them and writes both, so old
//                                      and new pages keep seeing each other.
//   users/{uid}/pdfs/{id}              { n, size }   — a PDF, written after all its chunks
//   users/{uid}/pdfs/{id}/chunks/{i}   { data }      — up to 900 KB of it (a document holds 1 MiB)
const SDK = "https://www.gstatic.com/firebasejs/12.6.0";
const CHUNK = 900_000;

export async function loadCloud(config) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const ref = (uid, ...path) => F.doc(db, "users", uid, ...path);

  return {
    signIn: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
    signOut: () => A.signOut(auth),
    onUser: (cb) => A.onAuthStateChanged(auth, cb),

    adapter: (uid, join) => makeAdapter(F, db, uid, join),

    async hasPdf(uid, id) {
      return (await F.getDoc(ref(uid, "pdfs", id))).exists();
    },
    async putPdf(uid, id, bytes) {
      const n = Math.ceil(bytes.length / CHUNK);
      for (let i = 0; i < n; i++) {
        await F.setDoc(ref(uid, "pdfs", id, "chunks", String(i)), { data: F.Bytes.fromUint8Array(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) });
      }
      await F.setDoc(ref(uid, "pdfs", id), { n, size: bytes.length });
    },
    async getPdf(uid, id) {
      const meta = await F.getDoc(ref(uid, "pdfs", id));
      if (!meta.exists()) return null;
      const { n, size } = meta.data();
      const out = new Uint8Array(size);
      for (let i = 0; i < n; i++) {
        const part = await F.getDoc(ref(uid, "pdfs", id, "chunks", String(i)));
        if (!part.exists()) return null;
        out.set(part.data().data.toUint8Array(), i * CHUNK);
      }
      return out;
    },
  };
}

// The account's copy of each section, as the sync engine sees it (see sync.js). F is the Firestore module.
// Sections are stored as JSON text: Firestore has no undefined, no nested arrays and limits on key names.
// Each section lives in sync/ and, for pages still running the code from before 12 November, in state/:
// both are read and joined (join(name, a, b), a union), and every write goes to both.
export function makeAdapter(F, db, uid, join = (name, a, b) => a ?? b) {
  const ref = (u, ...path) => F.doc(db, "users", u, ...path);
  const parse = (snap) => (snap.exists() ? JSON.parse(snap.data().json) : undefined);
  const both = (name, a, b) => (a === undefined ? b : b === undefined ? a : join(name, a, b));
  const heard = {};   // name -> { sync, state } as last heard from the server
  let heardAt = 0;    // when, for the check line in the menu
  const doc = (value) => ({ json: JSON.stringify(value), at: F.serverTimestamp() });
  return {
    // From the server only: a cached reply can say "no such document" just because the cache is
    // empty. Offline this throws, and syncing starts when the connection is back.
    async get(name) {
      const [a, b] = await Promise.all([F.getDocFromServer(ref(uid, "sync", name)), F.getDocFromServer(ref(uid, "state", name))]);
      heard[name] = { sync: parse(a), state: parse(b) };
      heardAt = Date.now();
      return both(name, heard[name].sync, heard[name].state);
    },
    set: (name, value) => Promise.all([F.setDoc(ref(uid, "sync", name), doc(value)), F.setDoc(ref(uid, "state", name), doc(value))]),
    // Read both copies and write the merged one in one transaction: a change another device made
    // while this one was not listening is merged in, not written over. fn may run again on a conflict.
    update: (name, fn) => F.runTransaction(db, async (tx) => {
      const a = parse(await tx.get(ref(uid, "sync", name)));
      const b = parse(await tx.get(ref(uid, "state", name)));
      const latest = both(name, a, b);
      const value = fn(latest === undefined ? undefined : JSON.parse(JSON.stringify(latest)));
      const target = value !== undefined ? value : latest;
      heard[name] = { sync: target ?? a, state: target ?? b };   // the last run is the one committed
      heardAt = Date.now();
      if (target !== undefined) {
        if (JSON.stringify(a) !== JSON.stringify(target)) tx.set(ref(uid, "sync", name), doc(target));
        if (JSON.stringify(b) !== JSON.stringify(target)) tx.set(ref(uid, "state", name), doc(target));
      }
      return { remote: latest, value };
    }),
    watch: (name, cb) => {
      const on = (where) => F.onSnapshot(ref(uid, where, name), (snap) => {
        // our own write is not news, and a reply from the cache is not the account's word
        if (snap.metadata.hasPendingWrites || snap.metadata.fromCache || !snap.exists()) return;
        heard[name] = { ...heard[name], [where]: JSON.parse(snap.data().json) };
        heardAt = Date.now();
        const v = both(name, heard[name].sync, heard[name].state);
        if (v !== undefined) cb(v);
      }, (e) => console.warn("watch", where, name, e));
      const stops = [on("sync"), on("state")];
      return () => stops.forEach((s) => s());
    },
    online: () => navigator.onLine,
    seen: () => ({ at: heardAt, copies: heard }),
  };
}
