# GitHub Auto-Builder 🚀

App para Android que captura código de conversas com IAs e commita automaticamente no GitHub!

## ✨ Funcionalidades

- 📋 Captura código da área de transferência
- 📁 Reconhece comandos `// FILE: caminho/arquivo.js`
- ✅ Valida paths antes de commitar
- 🔄 Cria repositórios automaticamente
- 📤 Commit direto no GitHub

## 🛠️ Como Usar

1. **Instalar o APK** (baixar dos Actions)
2. **Fazer login** com token GitHub
3. **Conversar com IA** e pedir código com `// FILE:`
4. **Copiar** o código da IA
5. **Tocar no botão flutuante** verde
6. **Confirmar** operação

## 📝 Formato dos Comandos

// FILE: src/components/Button.jsx
[seu código aqui]


## 🔧 Build pelo GitHub Actions

1. Fork este repositório
2. Adicionar secret `EXPO_TOKEN`
3. Push para main gera APK automaticamente

## 📥 Download do APK

Após o build, o APK estará disponível em:
**Actions → Último build → Artifacts**
