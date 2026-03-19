import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  Button,
  Alert,
  ScrollView,
  Modal,
  TextInput,
  TouchableOpacity
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import FloatingButton from './src/components/FloatingButton';
import { Octokit } from '@octokit/rest';
import { PathValidator } from './src/services/PathValidator';
import { ProjectStateManager } from './src/services/ProjectStateManager';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [githubToken, setGithubToken] = useState(null);
  const [githubUser, setGithubUser] = useState(null);
  const [currentRepo, setCurrentRepo] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [pendingOperation, setPendingOperation] = useState(null);
  const [projectState, setProjectState] = useState(null);

  // Descobrir paths similares quando detecta erro
  const findSimilarPaths = (wrongPath, existingPaths) => {
    return existingPaths.filter(path => {
      const similarity = calculateSimilarity(wrongPath, path);
      return similarity > 0.7;
    });
  };

  const calculateSimilarity = (str1, str2) => {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const costs = [];
    for (let i = 0; i <= longer.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= shorter.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[shorter.length] = lastValue;
    }
    
    return (longer.length - costs[shorter.length]) / longer.length;
  };

  useEffect(() => {
    loadStoredToken();
  }, []);

  const loadStoredToken = async () => {
    try {
      const token = await AsyncStorage.getItem('github_token');
      const user = await AsyncStorage.getItem('github_user');
      if (token) {
        setGithubToken(token);
        setGithubUser(JSON.parse(user));
        setIsAuthenticated(true);
        addLog('✅ Conectado ao GitHub');
        
        // Inicializar gerenciador de estado do projeto
        setProjectState(new ProjectStateManager());
      }
    } catch (error) {
      addLog(`❌ Erro ao carregar token: ${error.message}`);
    }
  };

  const addLog = (message) => {
    setLogs(prev => [...prev, { 
      id: Date.now() + Math.random(),
      text: message,
      timestamp: new Date().toLocaleTimeString() 
    }]);
  };

  const handleCapture = async () => {
    try {
      setIsCapturing(true);
      addLog('📋 Acessando área de transferência...');

      // 1. Pegar texto da área de transferência
      const text = await Clipboard.getStringAsync();
      
      if (!text) {
        addLog('⚠️ Área de transferência vazia');
        Alert.alert('Aviso', 'Copie o código da IA primeiro!');
        return;
      }

      addLog('✅ Texto capturado da área de transferência');

      // 2. Extrair paths do texto
      const paths = PathValidator.extractPathsFromText(text);
      
      if (paths.length === 0) {
        addLog('⚠️ Nenhum caminho de arquivo encontrado');
        Alert.alert('Aviso', 'Nenhum comando // FILE: encontrado no texto');
        return;
      }

      addLog(`📁 Encontrados ${paths.length} arquivos: ${paths.map(p => p.fullPath).join(', ')}`);

      // 3. Extrair blocos de código
      const codeBlocks = PathValidator.extractCodeBlocks(text);
      
      if (codeBlocks.length === 0) {
        addLog('⚠️ Nenhum bloco de código encontrado');
        return;
      }

      addLog(`📦 Encontrados ${codeBlocks.length} blocos de código`);

      // 4. Validar paths
      const validationResults = [];
      for (const path of paths) {
        const validation = PathValidator.validatePathSyntax(path.fullPath);
        validationResults.push({
          path: path.fullPath,
          ...validation
        });

        if (!validation.isValid) {
          addLog(`❌ Path inválido: ${path.fullPath} - ${validation.errors.join(', ')}`);
        } else if (validation.warnings.length > 0) {
          addLog(`⚠️ Path com avisos: ${path.fullPath} - ${validation.warnings.join(', ')}`);
        } else {
          addLog(`✅ Path válido: ${path.fullPath}`);
        }
      }

      // 5. Verificar se tem erros
      const hasErrors = validationResults.some(r => !r.isValid);
      
      if (hasErrors) {
        // Mostrar modal para correção
        setPendingOperation({
          type: 'validation_errors',
          paths: validationResults,
          codeBlocks,
          originalText: text
        });
        setModalVisible(true);
        return;
      }

      // 6. Se não tem repositório, perguntar para criar
      if (!currentRepo) {
        setPendingOperation({
          type: 'new_repo',
          paths: validationResults,
          codeBlocks
        });
        setModalVisible(true);
        return;
      }

      // 7. Fazer commit diretamente
      await commitFiles(codeBlocks, validationResults);

    } catch (error) {
      addLog(`❌ Erro: ${error.message}`);
      Alert.alert('Erro', error.message);
    } finally {
      setIsCapturing(false);
    }
  };

  const commitFiles = async (codeBlocks, validationResults, repo = currentRepo) => {
    if (!repo) {
      addLog('❌ Nenhum repositório selecionado');
      return;
    }

    addLog(`📤 Enviando para GitHub: ${repo.full_name}`);

    const octokit = new Octokit({ auth: githubToken });

    for (let i = 0; i < codeBlocks.length; i++) {
      const block = codeBlocks[i];
      const pathInfo = validationResults[i] || { path: 'unknown' };
      
      try {
        addLog(`📄 Commitando: ${pathInfo.path}`);

        // Verificar se arquivo já existe
        let sha = null;
        try {
          const { data } = await octokit.repos.getContent({
            owner: githubUser.login,
            repo: repo.name,
            path: pathInfo.path,
          });
          sha = data.sha;
          addLog(`  ↳ Arquivo existente, será atualizado`);
        } catch (error) {
          addLog(`  ↳ Novo arquivo será criado`);
        }

        // Criar ou atualizar arquivo
        await octokit.repos.createOrUpdateFileContents({
          owner: githubUser.login,
          repo: repo.name,
          path: pathInfo.path,
          message: `Add/Update ${pathInfo.path} via Auto-Builder`,
          content: Buffer.from(block.code).toString('base64'),
          sha,
        });

        addLog(`✅ ${pathInfo.path} commitado com sucesso`);

        // Registrar no estado do projeto
        if (projectState) {
          projectState.registerPath(pathInfo.path, block.code);
        }

      } catch (error) {
        addLog(`❌ Erro em ${pathInfo.path}: ${error.message}`);
      }
    }

    addLog('🎉 Todos os arquivos processados!');
    Alert.alert('Sucesso', 'Arquivos enviados para o GitHub!');
  };

  const createNewRepo = async (repoName) => {
    try {
      addLog(`📁 Criando repositório: ${repoName}`);

      const octokit = new Octokit({ auth: githubToken });
      
      const { data } = await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description: 'Criado via GitHub Auto-Builder',
        private: false,
        auto_init: true,
      });

      setCurrentRepo(data);
      addLog(`✅ Repositório criado: ${data.html_url}`);

      return data;

    } catch (error) {
      addLog(`❌ Erro ao criar repositório: ${error.message}`);
      throw error;
    }
  };

  const handleAuth = async () => {
    try {
      // Configuração do OAuth - você precisa criar um App no GitHub
      const redirectUri = AuthSession.makeRedirectUri({ useProxy: true });
      
      // IMPORTANTE: Substitua pelo seu Client ID após criar o app no GitHub
      const clientId = 'SEU_CLIENT_ID_AQUI'; 
      
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo%20user`;
      
      addLog('🔑 Abrindo navegador para autenticação...');
      
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      
      if (result.type === 'success') {
        // Extrair código da URL
        const params = new URLSearchParams(result.url.split('?')[1]);
        const code = params.get('code');
        
        // Aqui você precisaria de um backend para trocar code por token
        // Para teste inicial, vamos usar um token personal
        // MAS PARA FUNCIONAR, você precisa:
        // Opção 1: Usar um backend simples (recomendo)
        // Opção 2: Gerar um token pessoal no GitHub e colar manualmente
        
        Alert.alert(
          'Token necessário',
          'Cole seu token pessoal do GitHub (Settings -> Developer settings -> Personal access tokens)',
          [
            { text: 'Cancelar', style: 'cancel' },
            { 
              text: 'OK',
              onPress: async () => {
                // Implementar input de token manual
                promptForToken();
              }
            }
          ]
        );
      }
    } catch (error) {
      addLog(`❌ Erro na autenticação: ${error.message}`);
    }
  };

  const promptForToken = () => {
    Alert.prompt(
      'Token GitHub',
      'Cole seu token pessoal:',
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Salvar',
          onPress: async (token) => {
            if (token) {
              await saveToken(token);
            }
          }
        }
      ],
      'plain-text'
    );
  };

  const saveToken = async (token) => {
    try {
      const octokit = new Octokit({ auth: token });
      const { data } = await octokit.users.getAuthenticated();
      
      await AsyncStorage.setItem('github_token', token);
      await AsyncStorage.setItem('github_user', JSON.stringify(data));
      
      setGithubToken(token);
      setGithubUser(data);
      setIsAuthenticated(true);
      
      addLog(`✅ Bem-vindo, ${data.login}!`);
      
    } catch (error) {
      addLog(`❌ Token inválido: ${error.message}`);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('github_token');
    await AsyncStorage.removeItem('github_user');
    setIsAuthenticated(false);
    setGithubToken(null);
    setGithubUser(null);
    setCurrentRepo(null);
    addLog('👋 Desconectado do GitHub');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>GitHub Auto-Builder</Text>
          {githubUser && (
            <Text style={styles.userInfo}>@{githubUser.login}</Text>
          )}
        </View>
        {isAuthenticated ? (
          <Button title="Sair" onPress={handleLogout} color="#ff4444" />
        ) : (
          <Button title="Login" onPress={handleAuth} />
        )}
      </View>

      {/* Repo Info */}
      {currentRepo && (
        <View style={styles.repoInfo}>
          <Text style={styles.repoName}>📁 {currentRepo.name}</Text>
          <Text style={styles.repoUrl}>{currentRepo.html_url}</Text>
        </View>
      )}

      {/* Logs */}
      <ScrollView style={styles.logContainer}>
        {logs.map((log) => (
          <Text key={log.id} style={styles.logEntry}>
            [{log.timestamp}] {log.text}
          </Text>
        ))}
      </ScrollView>

      {/* Modal para confirmações */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {pendingOperation?.type === 'new_repo' 
                ? '📁 Criar Novo Repositório' 
                : '⚠️ Corrigir Paths'}
            </Text>
            
            {pendingOperation?.type === 'validation_errors' && (
              <>
                <Text style={styles.modalSubtitle}>Paths com problemas:</Text>
                {pendingOperation.paths
                  .filter(p => !p.isValid || p.warnings.length > 0)
                  .map((p, idx) => (
                    <View key={idx} style={styles.pathIssue}>
                      <Text style={styles.pathText}>{p.path}</Text>
                      {p.errors.map((err, i) => (
                        <Text key={i} style={styles.errorText}>❌ {err}</Text>
                      ))}
                      {p.warnings.map((warn, i) => (
                        <Text key={i} style={styles.warningText}>⚠️ {warn}</Text>
                      ))}
                    </View>
                  ))}
              </>
            )}

            {pendingOperation?.type === 'new_repo' && (
              <>
                <Text style={styles.modalText}>
                  Nenhum repositório selecionado. Deseja criar um novo?
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Nome do repositório"
                  autoCapitalize="none"
                  onChangeText={(text) => setPendingOperation({
                    ...pendingOperation,
                    repoName: text
                  })}
                />
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.button, styles.buttonCancel]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.buttonText}>Cancelar</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.button, styles.buttonConfirm]}
                onPress={async () => {
                  setModalVisible(false);
                  
                  if (pendingOperation?.type === 'new_repo' && pendingOperation.repoName) {
                    try {
                      const newRepo = await createNewRepo(pendingOperation.repoName);
                      await commitFiles(
                        pendingOperation.codeBlocks, 
                        pendingOperation.paths,
                        newRepo
                      );
                    } catch (error) {
                      Alert.alert('Erro', error.message);
                    }
                  } else {
                    // Prosseguir mesmo com avisos
                    await commitFiles(
                      pendingOperation?.codeBlocks,
                      pendingOperation?.paths
                    );
                  }
                }}
              >
                <Text style={styles.buttonText}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Botão Flutuante */}
      <FloatingButton 
        onPress={handleCapture} 
        disabled={!isAuthenticated || isCapturing}
        loading={isCapturing}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  userInfo: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  repoInfo: {
    padding: 10,
    backgroundColor: '#e3f2fd',
    borderBottomWidth: 1,
    borderBottomColor: '#b8dff0',
  },
  repoName: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  repoUrl: {
    fontSize: 12,
    color: '#1976d2',
  },
  logContainer: {
    flex: 1,
    padding: 10,
    backgroundColor: '#fff',
    margin: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  logEntry: {
    fontSize: 11,
    marginBottom: 3,
    color: '#333',
    fontFamily: 'monospace',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  modalSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  modalText: {
    fontSize: 14,
    marginBottom: 15,
  },
  pathIssue: {
    marginBottom: 15,
    padding: 10,
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
  },
  pathText: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 5,
  },
  errorText: {
    fontSize: 12,
    color: '#ff4444',
    marginLeft: 10,
  },
  warningText: {
    fontSize: 12,
    color: '#ff8800',
    marginLeft: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  button: {
    padding: 12,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  buttonCancel: {
    backgroundColor: '#ff4444',
  },
  buttonConfirm: {
    backgroundColor: '#4CAF50',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
