import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { env } from '../config/env';

export const api = axios.create({
  baseURL: env.apiUrl,
  timeout: 850000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('access_token');
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

api.interceptors.response.use(
  response => response,
  async error => {
    const isPasswordValidation = error.config?.headers?.['X-Password-Validation'] === 'true';
    const isLogin = error.config?.url === '/login';
    if (error.response?.status === 401 && !isPasswordValidation && !isLogin) {
      await SecureStore.deleteItemAsync('access_token');
      router.replace('/');
    }
    return Promise.reject(error);
  },
);
