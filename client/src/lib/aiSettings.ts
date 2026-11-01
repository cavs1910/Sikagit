import { api } from "./api";
import { useUIStore } from "../store/uiStore";
export async function refreshAISettings() {
  try {
    const s = await api.aiSettings();
    useUIStore.setState({
      aiEnabled: s.enabled,
      aiConfigured: s.hasApiKey && !!s.model,
    });
  } catch {
    useUIStore.setState({ aiEnabled: false, aiConfigured: false });
  }
}
