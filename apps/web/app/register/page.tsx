'use client';
import { FormEvent, useState } from 'react';

export default function RegisterPage() {
  const [email,setEmail]=useState(()=>typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('email')??'');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState('Créez votre compte FavLib avec votre adresse e-mail.');
  const submit=async(event:FormEvent)=>{event.preventDefault();const response=await fetch('/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(response.status===201){window.location.href=`/login?email=${encodeURIComponent(email)}`;return}const body=await response.json().catch(()=>null);setMessage(body?.error?.message??'Impossible de créer le compte.');};
  return <main className="login-page"><section className="card login-card"><a className="brand login-brand" href="/">Fav<span>Lib</span></a><div className="eyebrow">Créer un compte</div><h1 className="title">S’enregistrer</h1><p className="subtitle">{message}</p><form className="login-form" onSubmit={submit}><div className="login-field"><label htmlFor="register-email">Email</label><input className="input" id="register-email" type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} required /></div><div className="login-field"><label htmlFor="register-password">Mot de passe</label><input className="input" id="register-password" type="password" autoComplete="new-password" minLength={15} value={password} onChange={event=>setPassword(event.target.value)} required /><small className="register-note">15 caractères minimum.</small></div><button className="button primary login-submit" type="submit">Créer mon compte</button></form><p className="login-register"><a href="/login">Retour à la connexion</a></p></section></main>;
}
