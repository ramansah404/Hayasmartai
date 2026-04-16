import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC2qGLSvfjRbEIpJfqAvDDs5pba_vSOEIc",
  authDomain: "haya-404.firebaseapp.com",
  projectId: "haya-404",
  storageBucket: "haya-404.firebasestorage.app",
  messagingSenderId: "44959331392",
  appId: "1:44959331392:web:1ab91a8b39b552beaadba5",
  measurementId: "G-9VZC65Q83V"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("Error signing in with Google", error);
  }
};

export const logOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
  }
};
