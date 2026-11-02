import { ResourceLanguage } from 'i18next';
import common from '@/locales/en/common.json';
import bucketPicker from '@/locales/en/components/inputs/bucketPicker.json';
import inputs from '@/locales/en/components/inputs/inputs.json';
import connectionProfiles from '@/locales/en/components/layouts/navbar/connectionProfiles.json';
import objectDetailDrawer from '@/locales/en/components/layouts/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/en/components/layouts/tab/tabLayout.json';
import downloaderWindow from '@/locales/en/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/en/components/layouts/transfer/uploaderWindow.json';
import confirmModal from '@/locales/en/components/modals/confirmModal.json';
import connectModal from '@/locales/en/components/modals/connectModal.json';
import credentialExpiring from '@/locales/en/components/modals/credentialExpiring.json';
import historyModal from '@/locales/en/components/modals/historyModal.json';
import settingModal from '@/locales/en/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/en/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/en/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/en/messages/ipcMessage.json';
import validateMessage from '@/locales/en/messages/validateMessage.json';
import bucketPage from '@/locales/en/pages/bucket/page.json';
import objectPage from '@/locales/en/pages/object/page.json';

const englishResource: ResourceLanguage = {
  common: common,
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  credentialExpiring: credentialExpiring,
  confirmModal: confirmModal,
  historyModal: historyModal,
  settingModal: settingModal,
  uploadLimitModal: uploadLimitModal,
  uploadPickerModal: uploadPickerModal,
  bucketPicker: bucketPicker,
  connectionProfiles: connectionProfiles,
  bucket: {
    page: bucketPage,
  },
  object: {
    page: objectPage,
  },
  inputs: inputs,
  downloaderWindow: downloaderWindow,
  objectDetailDrawer: objectDetailDrawer,
  tabLayout: tabLayout,
  uploaderWindow: uploaderWindow,
};
export default englishResource;
