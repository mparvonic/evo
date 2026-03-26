import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "miroslav@parvonic.cz";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Heslo", type: "password" },
      },
      authorize(credentials) {
        if (
          credentials?.email === ADMIN_EMAIL &&
          credentials?.password === ADMIN_PASSWORD &&
          ADMIN_PASSWORD !== ""
        ) {
          return { id: "1", email: ADMIN_EMAIL, name: "Miroslav" };
        }
        return null;
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
});
