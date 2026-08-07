'use client';

import { FormEvent, useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState(() => typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('email') ?? '' : '');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('Connectez-vous pour confirmer l’appairage.');
  const next = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') ?? '/settings#extension' : '/settings#extension';
  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!response.ok) { setMessage('Identifiants invalides.'); return; }
    const body = await response.json();
    window.localStorage.setItem('favlib-csrf', body.csrfToken);
    window.location.href = next;
  }
  return <main className="login-page"><section className="card login-card"><a className="brand login-brand" href="/">Fav<span>Lib</span></a><div className="eyebrow">Session locale</div><h1 className="title">Se connecter</h1><p className="subtitle">{message}</p><form className="login-form" onSubmit={submit}><div className="login-field"><label htmlFor="email">Email</label><input className="input" id="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></div><div className="login-field"><label htmlFor="password">Mot de passe</label><input className="input" id="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></div><button className="button primary login-submit" type="submit">Se connecter</button></form><p className="login-register"><a href="/register">Créer un compte</a></p></section></main>;
}
