// The student's account: Google sign-in and their data in Firestore (Firebase, Google's free tier).
// Everything lives under users/{uid}/, and the project's rules let a person read and write only
// their own folder. Firebase is loaded from Google's CDN only when someone signs in.
//   users/{uid}/state/{section}        { json, at }  — one document per section of data
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

    // Sections are stored as JSON text: Firestore has no undefined, no nested arrays and limits on key names.
    adapter: (uid) => ({
      async get(name) {
        const snap = await F.getDoc(ref(uid, "state", name));
        return snap.exists() ? JSON.parse(snap.data().json) : undefined;
      },
      set: (name, value) => F.setDoc(ref(uid, "state", name), { json: JSON.stringify(value), at: F.serverTimestamp() }),
      watch: (name, cb) => F.onSnapshot(ref(uid, "state", name), (snap) => {
        if (snap.metadata.hasPendingWrites) return;        // our own write, not news
        cb(snap.exists() ? JSON.parse(snap.data().json) : undefined);
      }, (e) => console.warn("watch", name, e)),
      online: () => navigator.onLine,
    }),

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
