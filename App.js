import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { Base64 } from 'js-base64';
import { Octokit } from '@octokit/rest';

import FloatingButton from './src/components/FloatingButton';
import { PathValidator } from './src/services/PathValidator';
import { ProjectStateManager } from './src/services/ProjectStateManager';

const STORAGE_KEYS = {
  token: 'github_token',
  user: 'github_user',
  repo: 'current_repo'
};

export default function App() {
  const [githubToken, setGithubToken] = useState('');
  const [githubUser, setGithubUser] = useState(null);
  const [currentRepo, setCurrentRepo] = useState(null);
  const [logs, setLogs] = useState([]);
  const [isBusy, setIsBusy] = useState(false);

  const [tokenModalVisible, setTokenModalVisible] = useState(false);
  const [repoModalVisible, setRepoModalVisible] = useState(false);

  const [tokenInput, setTokenInput] = useState('');
  const [repoInput, setRepoInput] = useState('');
  const [createRepoIfMissing, setCreateRepoIfMissing] = useState(true);

  const [stateManager] = useState(() => new ProjectStateManager());

  const isAuthenticated = Boolean(githubToken && githubUser);

  const octokit = useMemo(() => {
    if (!githubToken) return null;
    return new Octokit({ auth: githubToken });
  }, [githubToken]);

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    try {
      const [storedToken, storedUser, storedRepo] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.token),
        AsyncStorage.getItem(STORAGE_KEYS.user),
        AsyncStorage.getItem(STORAGE_KEYS.repo)
      ]);

      if (storedToken && storedUser) {
        setGithubToken(storedToken);
        setGithubUser(JSON.parse(storedUser));
        addLog(`✅ Sessão restaurada: @${JSON.parse(storedUser).login}`);
      }

      if (storedRepo) {
        setCurrentRepo(JSON.parse(storedRepo));
        addLog(`✅ Repositório restaurado: ${JSON.parse(storedRepo).full_name}`);
      }
    } catch (error) {
      addLog(`❌ Falha ao restaurar sessão: ${error.message}`);
    }
  }

  function addLog(message) {
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        timestamp: new Date().toLocaleTimeString(),
        message
      },
      ...prev
    ]);
  }

  async function handleSaveToken() {
    const token = tokenInput.trim();

    if (!token) {
      Alert.alert('Token em falta', 'Cole um token pessoal do GitHub.');
      return;
    }

    try {
      setIsBusy(true);
      addLog('🔐 Validando token GitHub...');

      const client = new Octokit({ auth: token });
      const { data: user } = await client.users.getAuthenticated();

      await AsyncStorage.multiSet([
        [STORAGE_KEYS.token, token],
        [STORAGE_KEYS.user, JSON.stringify(user)]
      ]);

      setGithubToken(token);
      setGithubUser(user);
      setTokenInput('');
      setTokenModalVisible(false);

      addLog(`✅ Autenticado como @${user.login}`);
    } catch (error) {
      addLog(`❌ Token inválido: ${error.message}`);
      Alert.alert('Erro', `Token inválido: ${error.message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLogout() {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.token,
      STORAGE_KEYS.user,
      STORAGE_KEYS.repo
    ]);

    setGithubToken('');
    setGithubUser(null);
    setCurrentRepo(null);

    addLog('🚪 Sessão removida');
  }

  function parseRepoInput(value) {
    const clean = String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    const parts = clean.split('/').filter(Boolean);

    if (parts.length === 1 && githubUser?.login) {
      return { owner: githubUser.login, repo: parts[0] };
    }

    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }

    return null;
  }

  async function ensureRepoExists(owner, repo) {
    try {
      const { data } = await octokit.repos.get({ owner, repo });
      return data;
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }

      if (!createRepoIfMissing) {
        throw new Error(`Repositório ${owner}/${repo} não existe`);
      }

      if (!githubUser || owner !== githubUser.login) {
        throw new Error('Só consigo criar automaticamente repositórios na tua conta autenticada');
      }

      addLog(`📦 Repositório ${owner}/${repo} não existe. A criar...`);

      const { data } = await octokit.repos.createForAuthenticatedUser({
        name: repo,
        private: false,
        auto_init: true,
        description: 'Criado via GitHub Auto Builder'
      });

      return data;
    }
  }

  async function handleSaveRepo() {
    if (!octokit || !githubUser) {
      Alert.alert('Erro', 'Autentica primeiro no GitHub.');
      return;
    }

    const parsed = parseRepoInput(repoInput);
    if (!parsed) {
      Alert.alert('Repo inválida', 'Usa "nome-da-repo" ou "owner/nome-da-repo".');
      return;
    }

    try {
      setIsBusy(true);
      addLog(`🔎 A validar repositório ${parsed.owner}/${parsed.repo}...`);

      const repo = await ensureRepoExists(parsed.owner, parsed.repo);

      await AsyncStorage.setItem(STORAGE_KEYS.repo, JSON.stringify(repo));
      setCurrentRepo(repo);
      setRepoInput('');
      setRepoModalVisible(false);

      addLog(`✅ Repositório ativo: ${repo.full_name}`);
    } catch (error) {
      addLog(`❌ Falha ao definir repo: ${error.message}`);
      Alert.alert('Erro', error.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function commitSingleFile(owner, repo, path, code) {
    let sha;

    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path
      });

      if (!Array.isArray(data) && data?.sha) {
        sha = data.sha;
      }
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `chore(auto-builder): update ${path}`,
      content: Base64.encode(code),
      sha
    });
  }

  async function handleCapture() {
    if (!isAuthenticated) {
      setTokenModalVisible(true);
      return;
    }

    if (!currentRepo) {
      setRepoModalVisible(true);
      return;
    }

    try {
      setIsBusy(true);
      addLog('📋 A ler área de transferência...');

      const text = await Clipboard.getStringAsync();
      if (!text || !text.trim()) {
        throw new Error('Área de transferência vazia');
      }

      const entries = PathValidator.extractFileEntries(text);

      if (!entries.length) {
        throw new Error('Nenhum bloco // FILE: válido foi encontrado');
      }

      const invalidEntries = entries.filter((entry) => !entry.isValid);
      if (invalidEntries.length) {
        const message = invalidEntries
          .map((entry) => `${entry.rawPath} -> ${entry.errors.join(', ')}`)
          .join('\n');

        addLog(`❌ Paths inválidos: ${message}`);
        Alert.alert('Paths inválidos', message);
        return;
      }

      addLog(`🧠 ${entries.length} ficheiro(s) detetado(s) para commit`);

      const owner = currentRepo.owner.login;
      const repo = currentRepo.name;

      for (const entry of entries) {
        addLog(`⬆️ Commitando ${entry.path}...`);
        await commitSingleFile(owner, repo, entry.path, entry.code);
        stateManager.registerPath(entry.path, entry.code);
        addLog(`✅ ${entry.path} enviado`);
      }

      Alert.alert('Sucesso', `${entries.length} ficheiro(s) enviados para ${currentRepo.full_name}`);
      addLog(`🎉 Operação concluída em ${currentRepo.full_name}`);
    } catch (error) {
      addLog(`❌ ${error.message}`);
      Alert.alert('Erro', error.message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>GitHub Auto Builder</Text>
          <Text style={styles.subtitle}>
            {githubUser ? `Ligado como @${githubUser.login}` : 'Sem autenticação'}
          </Text>
          <Text style={styles.repoText}>
            {currentRepo ? `Repo ativa: ${currentRepo.full_name}` : 'Repo ativa: nenhuma'}
          </Text>
        </View>

        <View style={styles.headerButtons}>
          {isAuthenticated ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={handleLogout}>
              <Text style={styles.secondaryButtonText}>Sair</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.primaryButton} onPress={() => setTokenModalVisible(true)}>
              <Text style={styles.primaryButtonText}>Token</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setTokenModalVisible(true)}
          disabled={isBusy}
        >
          <Text style={styles.actionButtonText}>Configurar token</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setRepoModalVisible(true)}
          disabled={isBusy || !isAuthenticated}
        >
          <Text style={styles.actionButtonText}>Definir repo</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.helpCard}>
        <Text style={styles.helpTitle}>Formato esperado</Text>
        <Text style={styles.helpText}>
          // FILE: src/components/Button.js
        </Text>
        <Text style={styles.helpText}>
          ```js
        </Text>
        <Text style={styles.helpText}>
          export default function Button() {'{'} return null; {'}'}
        </Text>
        <Text style={styles.helpText}>
          ```
        </Text>
      </View>

      <ScrollView style={styles.logPanel} contentContainerStyle={styles.logPanelContent}>
        {logs.length === 0 ? (
          <Text style={styles.emptyLogs}>Sem logs ainda.</Text>
        ) : (
          logs.map((log) => (
            <View key={log.id} style={styles.logItem}>
              <Text style={styles.logTimestamp}>[{log.timestamp}]</Text>
              <Text style={styles.logMessage}>{log.message}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <FloatingButton onPress={handleCapture} loading={isBusy} disabled={false} />

      <Modal visible={tokenModalVisible} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Token GitHub</Text>
            <Text style={styles.modalText}>
              Cola aqui um Personal Access Token com permissões de repositório.
            </Text>

            <TextInput
              value={tokenInput}
              onChangeText={setTokenInput}
              style={styles.input}
              placeholder="ghp_..."
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setTokenModalVisible(false)}
              >
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.primaryButton} onPress={handleSaveToken}>
                <Text style={styles.primaryButtonText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={repoModalVisible} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Repositório alvo</Text>
            <Text style={styles.modalText}>
              Usa "nome-da-repo", "owner/repo" ou cola a URL do GitHub.
            </Text>

            <TextInput
              value={repoInput}
              onChangeText={setRepoInput}
              style={styles.input}
              placeholder="AndreVazao/minha-repo"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setCreateRepoIfMissing((prev) => !prev)}
            >
              <View style={[styles.checkbox, createRepoIfMissing && styles.checkboxChecked]} />
              <Text style={styles.checkboxText}>Criar repo automaticamente se não existir</Text>
            </TouchableOpacity>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setRepoModalVisible(false)}
              >
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.primaryButton} onPress={handleSaveRepo}>
                <Text style={styles.primaryButtonText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a'
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800'
  },
  subtitle: {
    color: '#cbd5e1',
    marginTop: 4,
    fontSize: 13
  },
  repoText: {
    color: '#93c5fd',
    marginTop: 6,
    fontSize: 13
  },
  headerButtons: {
    marginLeft: 12
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700'
  },
  secondaryButton: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontWeight: '700'
  },
  actionRow: {
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 10
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14
  },
  actionButtonText: {
    color: '#f8fafc',
    fontWeight: '700',
    textAlign: 'center'
  },
  helpCard: {
    marginHorizontal: 18,
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937'
  },
  helpTitle: {
    color: '#ffffff',
    fontWeight: '800',
    marginBottom: 8
  },
  helpText: {
    color: '#cbd5e1',
    fontFamily: 'monospace'
  },
  logPanel: {
    flex: 1,
    marginTop: 14
  },
  logPanelContent: {
    paddingHorizontal: 18,
    paddingBottom: 120
  },
  emptyLogs: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 12
  },
  logItem: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10
  },
  logTimestamp: {
    color: '#93c5fd',
    fontSize: 12,
    marginBottom: 4
  },
  logMessage: {
    color: '#e5e7eb',
    fontSize: 14,
    lineHeight: 20
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.75)',
    justifyContent: 'center',
    padding: 18
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1f2937'
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8
  },
  modalText: {
    color: '#cbd5e1',
    marginBottom: 14,
    lineHeight: 20
  },
  input: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155',
    color: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#64748b',
    marginRight: 10,
    backgroundColor: '#111827'
  },
  checkboxChecked: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb'
  },
  checkboxText: {
    color: '#e2e8f0',
    flex: 1
  }
});
