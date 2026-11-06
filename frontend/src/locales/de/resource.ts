import { ResourceLanguage } from 'i18next';
import common from '@/locales/de/common.json';
import bucketPicker from '@/locales/de/components/inputs/bucketPicker.json';
import inputs from '@/locales/de/components/inputs/inputs.json';
import appUpdate from '@/locales/de/components/layouts/appUpdate.json';
import connectionProfiles from '@/locales/de/components/layouts/navbar/connectionProfiles.json';
import downloaderWindow from '@/locales/de/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/de/components/layouts/transfer/uploaderWindow.json';
import bucketPolicyModal from '@/locales/de/components/modals/bucketPolicyModal.json';
import confirmModal from '@/locales/de/components/modals/confirmModal.json';
import connectModal from '@/locales/de/components/modals/connectModal.json';
import createBucketModal from '@/locales/de/components/modals/createBucketModal.json';
import credentialExpiring from '@/locales/de/components/modals/credentialExpiring.json';
import deleteBucketModal from '@/locales/de/components/modals/deleteBucketModal.json';
import deleteConfirmModal from '@/locales/de/components/modals/deleteConfirmModal.json';
import deleteResultModal from '@/locales/de/components/modals/deleteResultModal.json';
import historyModal from '@/locales/de/components/modals/historyModal.json';
import settingModal from '@/locales/de/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/de/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/de/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/de/messages/ipcMessage.json';
import validateMessage from '@/locales/de/messages/validateMessage.json';
import bucketPage from '@/locales/de/pages/tab/bucket/page.json';
import bucketDetailDrawer from '@/locales/de/pages/tab/bucketDetailDrawer.json';
import objectPage from '@/locales/de/pages/tab/object/page.json';
import objectDetailDrawer from '@/locales/de/pages/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/de/pages/tab/tabLayout.json';

const germanResource: ResourceLanguage = {
  common: common,
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  credentialExpiring: credentialExpiring,
  confirmModal: confirmModal,
  bucketPolicyModal: bucketPolicyModal,
  createBucketModal: createBucketModal,
  deleteBucketModal: deleteBucketModal,
  deleteConfirmModal: deleteConfirmModal,
  deleteResultModal: deleteResultModal,
  historyModal: historyModal,
  settingModal: settingModal,
  uploadLimitModal: uploadLimitModal,
  uploadPickerModal: uploadPickerModal,
  appUpdate: appUpdate,
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
  bucketDetailDrawer: bucketDetailDrawer,
  objectDetailDrawer: objectDetailDrawer,
  tabLayout: tabLayout,
  uploaderWindow: uploaderWindow,
};
export default germanResource;
