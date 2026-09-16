import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
        
        try {
          const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            body: JSON.stringify(credentials),
            headers: { "Content-Type": "application/json" }
          });
          
          const user = await res.json();
          if (res.ok && user) {
            return {
              id: user.user.id,
              name: user.user.name,
              email: user.user.email,
              token: user.token
            };
          }
          return null;
        } catch (e) {
          console.error(e);
          return null;
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.accessToken = (user as any).token;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string;
      }
      (session as any).accessToken = token.accessToken;
      return session;
    }
  },
  pages: {
    signIn: '/', // we will show login modal/form on homepage
  },
  session: {
    strategy: "jwt"
  }
});

export { handler as GET, handler as POST };
