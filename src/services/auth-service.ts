import * as SecureStore from 'expo-secure-store';
import { api } from '../lib/api';

type LoginRequest =
  | { email: string; password: string }
  | { login: string; password: string };

interface LoginResponse {
  accessToken: string;
}

export const authService = {
  async login(request: LoginRequest): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>('/login', request);
    if (!data?.accessToken) throw new Error('Token de acesso ausente na resposta.');
    await SecureStore.setItemAsync('access_token', data.accessToken);
    return data;
  },
};
