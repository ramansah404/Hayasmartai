import { db } from '../firebase';
import { collection, doc, setDoc, addDoc, query, orderBy, onSnapshot, serverTimestamp, getDoc, deleteDoc, getDocs, deleteField, limit } from 'firebase/firestore';

export const loadHistory = async (userId: string) => {
  const q = query(
    collection(db, "users", userId, "conversations"),
    orderBy("timestamp", "desc"),
    limit(10)
  );
  const snapshot = await getDocs(q);
  let history: any[] = [];
  snapshot.forEach(d => {
    history.push(d.data());
  });
  return history.reverse(); // Reverse to get chronological order
};

export const loadMemory = async (userId: string) => {
  const ref = doc(db, "users", userId);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) {
    return snapshot.data().memory || {};
  }
  return {};
};

export const saveConversation = async (userId: string, userMsg: string, aiMsg: string) => {
  try {
    await addDoc(collection(db, 'users', userId, 'conversations'), {
      user_message: userMsg,
      ai_response: aiMsg,
      timestamp: serverTimestamp()
    });
  } catch (e) {
    console.error("Error saving conversation:", e);
  }
};

export const subscribeToMessages = (userId: string, callback: (messages: any[]) => void) => {
  const q = query(collection(db, 'users', userId, 'conversations'), orderBy('timestamp', 'asc'));
  return onSnapshot(q, (snapshot) => {
    const msgs: any[] = [];
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.user_message) {
        msgs.push({ id: doc.id + '_user', sender: 'user', text: data.user_message });
      }
      if (data.ai_response) {
        msgs.push({ id: doc.id + '_haya', sender: 'haya', text: data.ai_response });
      }
    });
    callback(msgs);
  }, (error) => {
    console.error("Error subscribing to messages:", error);
  });
};

export const clearMessages = async (userId: string) => {
  try {
    const q = query(collection(db, 'users', userId, 'conversations'));
    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
  } catch (e) {
    console.error("Error clearing messages:", e);
  }
};

export const savePreferences = async (userId: string, memory: Record<string, any>) => {
  try {
    await setDoc(doc(db, 'users', userId), { memory }, { merge: true });
  } catch (e) {
    console.error("Error saving memory:", e);
  }
};

export const updatePreference = async (userId: string, key: string, value: any) => {
  try {
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, { memory: { [key]: value } }, { merge: true });
  } catch (e) {
    console.error("Error updating memory:", e);
  }
};

export const deletePreference = async (userId: string, key: string) => {
  try {
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, { memory: { [key]: deleteField() } }, { merge: true });
  } catch (e) {
    console.error("Error deleting memory:", e);
  }
};

export const subscribeToPreferences = (userId: string, callback: (memory: Record<string, any>) => void) => {
  return onSnapshot(doc(db, 'users', userId), (docSnap) => {
    if (docSnap.exists() && docSnap.data().memory) {
      callback(docSnap.data().memory);
    } else {
      callback({});
    }
  }, (error) => {
    console.error("Error subscribing to memory:", error);
  });
};
