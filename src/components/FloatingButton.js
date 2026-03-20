import React from 'react';
import { TouchableOpacity, StyleSheet, Text, ActivityIndicator } from 'react-native';

export default function FloatingButton({ onPress, disabled = false, loading = false }) {
  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      {loading ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.icon}>↑</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#18a957',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.24,
    shadowRadius: 6
  },
  buttonDisabled: {
    backgroundColor: '#9ca3af'
  },
  icon: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
    marginTop: -2
  }
});
