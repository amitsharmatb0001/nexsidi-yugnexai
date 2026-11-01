import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db/pool";
import { fail, handler, ok } from "../http/respond";
import { signToken } from "../middleware/auth";

const COLUMNS = "__USER_COLUMNS__";

const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters for the password"),
  /*__NAME_FIELD__*/
});

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

type UserRow = { id: string; email: string; role?: string } & Record<string, unknown>;

function answer(user: UserRow) {
  const role = user.role ?? "user";
  return { token: signToken({ id: String(user.id), email: user.email, role }), user: { ...user, role } };
}

// The new account gets the table's default role: a caller never chooses one.
export const signUp = handler(async (req, res) => {
  const parsed = signUpSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]!.message);
  const { email, password /*__NAME_VAR__*/ } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (__INSERT_COLUMNS__) VALUES (__INSERT_VALUES__) ON CONFLICT (email) DO NOTHING RETURNING ${COLUMNS}`,
    [__INSERT_PARAMS__],
  );
  if (rows.length === 0) return fail(res, 409, "An account with this email already exists");
  ok(res, answer(rows[0]!), 201);
});

export const signIn = handler(async (req, res) => {
  const parsed = signInSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]!.message);
  const { email, password } = parsed.data;
  const { rows } = await pool.query<UserRow & { password_hash: string }>(`SELECT ${COLUMNS}, password_hash FROM users WHERE email = $1`, [email]);
  const found = rows[0];
  if (!found || !(await bcrypt.compare(password, found.password_hash))) return fail(res, 401, "Wrong email or password");
  const { password_hash: _hash, ...user } = found;
  ok(res, answer(user as UserRow));
});
