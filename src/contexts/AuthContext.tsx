import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { User } from '../types';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);
// We don't strictly enforce DATA_ENTRY_EMAILS list for login success, 
// as long as they are authenticated, but we assign roles based on the admin list.
// Any non-admin is data-entry.

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                try {
                    console.log("LOGIN SUCCESS UID:", firebaseUser.uid);
                    // Fetch role from Firestore "user" (singular) collection
                    const userDocRef = doc(db, 'user', firebaseUser.uid);
                    const userSnap = await getDoc(userDocRef);

                    let role: 'admin' | 'data-entry' = 'data-entry'; // Default

                    if (userSnap.exists()) {
                        const data = userSnap.data();
                        const rawRole = data.role || '';
                        console.log("RAW ROLE FROM DB:", rawRole);

                        if (rawRole.toLowerCase() === 'admin') {
                            role = 'admin';
                        }
                        console.log("NORMALIZED ROLE =", role);
                    } else {
                        console.warn("User document not found for UID:", firebaseUser.uid);
                        console.log("ROLE FROM FIRESTORE = null (defaulting to data-entry)");
                    }

                    // HARDCODED FALLBACK FOR SPECIFIC ADMINS
                    const ADMIN_EMAILS = ['hemk3672@gmail.com', 'rojes@gmail.com'];
                    if (firebaseUser.email && ADMIN_EMAILS.includes(firebaseUser.email.toLowerCase())) {
                        console.log(`Email ${firebaseUser.email} is in hardcoded admin list. Forcing role to ADMIN.`);
                        role = 'admin';
                    }

                    console.log("FINAL USER ROLE =", role);

                    setUser({
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        role
                    });

                } catch (error) {
                    console.error("Error fetching user role:", error);
                    // Fallback in case of error
                    setUser({
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        role: 'data-entry'
                    });
                }
            } else {
                setUser(null);
            }
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const logout = () => signOut(auth);

    return (
        <AuthContext.Provider value={{ user, loading, logout }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
