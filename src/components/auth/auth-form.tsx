'use client';
import { useState } from 'react';
import { navigateWithFreshDocument } from '@/modules/auth/navigation';
import Link from 'next/link';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authClient } from '@/modules/auth/client';
type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';
export function AuthForm({
  mode,
  token,
  verified = false,
}: {
  mode: Mode;
  token?: string;
  verified?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '')
      .trim()
      .toLowerCase();
    const password = String(data.get('password') ?? '');
    try {
      if (mode === 'login') {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) {
          setError('No pudimos iniciar sesión. Revisá tus datos y verificá tu correo.');
          return;
        }
        navigateWithFreshDocument('/empresas');
      } else if (mode === 'register') {
        const name = String(data.get('name') ?? '').trim();
        if (name.length < 2 || name.length > 80) {
          setError('Ingresá un nombre de entre 2 y 80 caracteres.');
          return;
        }
        const result = await authClient.signUp.email({
          name,
          email,
          password,
          callbackURL: '/ingresar?verificado=1',
        });
        if (result.error) {
          setError('No pudimos completar el registro. Revisá los datos o intentá más tarde.');
          return;
        }
        setMessage(
          'Revisá tu correo. Si la cuenta puede registrarse, recibirás un enlace para verificarla.',
        );
      } else if (mode === 'verify') {
        const result = await authClient.sendVerificationEmail({
          email,
          callbackURL: '/ingresar?verificado=1',
        });
        if (result.error) {
          setError('No pudimos procesar la solicitud. Intentá más tarde.');
          return;
        }
        setMessage('Si la cuenta necesita verificar su correo, recibirás un nuevo enlace.');
      } else if (mode === 'forgot') {
        const result = await authClient.requestPasswordReset({ email, redirectTo: '/restablecer' });
        if (result.error) {
          setError('No pudimos procesar la solicitud. Intentá más tarde.');
          return;
        }
        setMessage(
          'Si existe una cuenta con ese correo, recibirás un enlace para restablecer tu contraseña.',
        );
      } else {
        if (!token) {
          setError('El enlace no es válido. Solicitá uno nuevo.');
          return;
        }
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) {
          setError('El enlace venció o no es válido. Solicitá uno nuevo.');
          return;
        }
        setMessage(
          'Tu contraseña se actualizó y se cerraron las sesiones anteriores. Ya podés ingresar.',
        );
      }
    } catch {
      setError('No pudimos conectarnos. Intentá nuevamente.');
    } finally {
      setPending(false);
    }
  }
  const label = {
    login: 'Ingresar a mi cuenta',
    register: 'Crear mi cuenta',
    forgot: 'Enviar enlace',
    reset: 'Guardar contraseña',
    verify: 'Reenviar verificación',
  }[mode];
  return (
    <>
      {verified && (
        <p className="form-message" role="status">
          Tu correo ya está verificado. Ingresá para continuar.
        </p>
      )}
      {message ? (
        <div className="auth-success">
          <p role="status">{message}</p>
          <Button asChild variant="outline">
            <Link href="/ingresar">Volver a ingresar</Link>
          </Button>
        </div>
      ) : (
        <form className="account-form" onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Tu nombre
              <input name="name" autoComplete="name" minLength={2} maxLength={80} required />
            </label>
          )}
          {mode !== 'reset' && (
            <label>
              Correo electrónico
              <input name="email" type="email" autoComplete="email" maxLength={254} required />
            </label>
          )}
          {mode !== 'forgot' && mode !== 'verify' && (
            <label>
              Contraseña
              <input
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'login' ? 1 : 12}
                maxLength={128}
                required
              />
              {mode !== 'login' && (
                <small>Usá al menos 12 caracteres. Podés usar una frase larga.</small>
              )}
            </label>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? <LoaderCircle size={17} className="spin" /> : null}
            {pending ? 'Procesando…' : label}
            {!pending && <ArrowRight size={17} />}
          </Button>
        </form>
      )}
      <div className="auth-links">
        {mode === 'login' ? (
          <>
            <Link href="/recuperar">Olvidé mi contraseña</Link>
            <Link href="/verificar">Reenviar correo de verificación</Link>
            <span>
              ¿Todavía no tenés cuenta? <Link href="/registro">Registrate</Link>
            </span>
          </>
        ) : (
          <Link href="/ingresar">Ya tengo una cuenta</Link>
        )}
      </div>
    </>
  );
}
