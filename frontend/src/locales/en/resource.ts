import { ResourceLanguage } from 'i18next';
import inputs from '@/locales/en/components/inputs.json';
import connectModal from '@/locales/en/components/modals/connectModal.json';
import ipcMessage from '@/locales/en/messages/ipcMessage.json';
import validateMessage from '@/locales/en/messages/validateMessage.json';

const englishResource: ResourceLanguage = {
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  inputs: inputs,
};
export default englishResource;
