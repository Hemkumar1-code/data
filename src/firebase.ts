import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBKlPQFBXPEmrYI3eHkEY2NHwMrP-enBZw",
    authDomain: "data-entry-system-7ed74.firebaseapp.com",
    projectId: "data-entry-system-7ed74",
    storageBucket: "data-entry-system-7ed74.firebasestorage.app",
    messagingSenderId: "325458354960",
    appId: "1:325458354960:web:8c3653104eaf6382e93b95",
    measurementId: "G-20HD640DEW"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
