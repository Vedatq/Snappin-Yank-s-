// expo-video + native Firebase — EAS Build APK gerekir.
// Firebase: Authentication→Anonymous, Firestore, Storage açık olmalı.

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  ScrollView, Image, StyleSheet, Alert, ActivityIndicator
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import storage from '@react-native-firebase/storage';

const PURPLE = '#6C3CE9';
const DARK = '#4A25A8';

const initialVideos = [
  {
    title: 'VB Tube dünyasına hoş geldin!',
    channel: 'VB Tube',
    description: 'Yeni video sosyal medya platformu.',
    uri: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=900',
    type: 'image'
  },
  {
    title: 'Yeni videolar burada!',
    channel: 'VB Creator',
    description: 'İzle, paylaş ve keşfet.',
    uri: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=900',
    type: 'image'
  }
];

function VideoPlayer({ uri, height = 210 }) {
  const player = useVideoPlayer(uri, p => {
    p.loop = false;
    p.muted = true;
    p.timeUpdateEventInterval = 0;
  });

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      allowsFullscreen
      allowsPictureInPicture={false}
      style={{ width: '100%', height, backgroundColor: '#000' }}
    />
  );
}

export default function App() {
  const [tab, setTab] = useState('home');
  const [videos, setVideos] = useState([]);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [channel, setChannel] = useState('VB Creator');
  const [media, setMedia] = useState(null);
  const [comment, setComment] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [user, setUser] = useState(null);
  const [statusMsg, setStatusMsg] = useState('Bağlanıyor...');

  useEffect(() => {
    const unsub = auth().onAuthStateChanged(u => {
      if (u) setUser(u);
      else
        auth().signInAnonymously().catch(e => {
          Alert.alert('Giriş hatası', 'Anonymous açık mı?\n\n' + e.message);
          setLoading(false);
        });
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    let unsub = () => {};
    setStatusMsg('Videolar yükleniyor...');

    (async () => {
      try {
        const seedRef = firestore().collection('meta').doc('seed');
        const seedSnap = await seedRef.get();
        if (!seedSnap.exists) {
          const batch = firestore().batch();
          initialVideos.forEach(v => {
            const ref = firestore().collection('videos').doc();
            batch.set(ref, {
              title: v.title,
              channel: v.channel,
              description: v.description,
              uri: v.uri,
              type: v.type,
              likes: 0,
              comments: [],
              createdAt: firestore.FieldValue.serverTimestamp()
            });
          });
          batch.set(seedRef, { seededAt: firestore.FieldValue.serverTimestamp() });
          await batch.commit();
        }

        unsub = firestore()
          .collection('videos')
          .orderBy('createdAt', 'desc')
          .onSnapshot(
            snap => {
              setVideos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
              setLoading(false);
            },
            err => {
              Alert.alert('Firestore', err.message);
              setLoading(false);
            }
          );
      } catch (e) {
        Alert.alert('Başlatma hatası', e.message);
        setLoading(false);
      }
    })();

    return () => unsub();
  }, [user]);

  const selected = useMemo(
    () => videos.find(v => v.id === selectedId) ?? null,
    [videos, selectedId]
  );

  const pickMedia = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('İzin gerekli', 'Galeri izni vermelisin.');
      return;
    }
    const mediaTypes = ImagePicker.MediaType ? ['images', 'videos'] : ImagePicker.MediaTypeOptions.All;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      allowsEditing: false,
      quality: 0.7,
      videoMaxDuration: 120
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setMedia({
        uri: asset.uri,
        type: asset.type === 'video' ? 'video' : 'image'
      });
    }
  };

  const uploadMedia = async m => {
    const response = await fetch(m.uri);
    const blob = await response.blob();
    const ext = m.type === 'video' ? 'mp4' : 'jpg';
    const contentType = m.type === 'video' ? 'video/mp4' : 'image/jpeg';
    const path = `videos/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const ref = storage().ref(path);
    await ref.put(blob, { contentType });
    return await ref.getDownloadURL();
  };

  const publish = async () => {
    if (!title.trim() || !media) {
      Alert.alert('Eksik bilgi', 'Başlık ve fotoğraf/video seçmelisin.');
      return;
    }
    if (publishing) return;
    setPublishing(true);
    try {
      const url = await uploadMedia(media);
      await firestore().collection('videos').add({
        title: title.trim(),
        channel: channel.trim() || 'VB Creator',
        description: '',
        uri: url,
        type: media.type,
        likes: 0,
        comments: [],
        createdAt: firestore.FieldValue.serverTimestamp()
      });
      setTitle('');
      setMedia(null);
      setTab('home');
      Alert.alert('VB Tube', 'Paylaşım yüklendi!');
    } catch (e) {
      Alert.alert('Yükleme hatası', e.message);
    } finally {
      setPublishing(false);
    }
  };

  const likeVideo = async id => {
    try {
      await firestore().collection('videos').doc(id).update({ likes: firestore.FieldValue.increment(1) });
    } catch (e) {
      Alert.alert('Beğeni hatası', e.message);
    }
  };

  const addComment = async () => {
    if (!comment.trim() || !selectedId) return;
    try {
      await firestore().collection('videos').doc(selectedId).update({
        comments: firestore.FieldValue.arrayUnion({
          id: Date.now().toString(),
          text: comment.trim()
        })
      });
      setComment('');
    } catch (e) {
      Alert.alert('Yorum hatası', e.message);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter(v => `${v.title} ${v.channel}`.toLowerCase().includes(q));
  }, [videos, search]);

  const shorts = useMemo(() => videos.filter(v => v.type === 'video'), [videos]);

  const Header = ({ text }) => (
    <View style={styles.header}>
      <Text style={styles.logo}>VB <Text style={{ color: '#fff' }}>Tube</Text></Text>
      <Text style={styles.headerTitle}>{text}</Text>
    </View>
  );

  const MediaView = ({ item, height = 210 }) =>
    item.type === 'video' ? (
      <VideoPlayer uri={item.uri} height={height} />
    ) : (
      <Image source={{ uri: item.uri }} style={{ width: '100%', height, backgroundColor: '#000' }} resizeMode="cover" />
    );

  const VideoCard = ({ item }) => (
    <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => setSelectedId(item.id)}>
      <MediaView item={item} />
      <View style={styles.cardBody}>
        <Text style={styles.videoTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.channel}>▶ {item.channel}</Text>
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => likeVideo(item.id)}>
            <Text style={styles.actionText}>❤️ {item.likes || 0}</Text>
          </TouchableOpacity>
          <Text style={styles.actionText}>💬 {(item.comments || []).length}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PURPLE} />
        <Text style={{ marginTop: 10 }}>{statusMsg}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {tab === 'home' && (
        <>
          <Header text="Ana Sayfa" />
          <TextInput style={styles.search} placeholder="🔎 Video veya kanal ara..." value={search} onChangeText={setSearch} />
          <FlatList data={filtered} keyExtractor={item => item.id} renderItem={({ item }) => <VideoCard item={item} />} />
        </>
      )}

      {tab === 'shorts' && (
        <>
          <Header text="VB Shorts" />
          <FlatList data={shorts} keyExtractor={item => item.id} renderItem={({ item }) => (
            <TouchableOpacity style={styles.shortCard} onPress={() => setSelectedId(item.id)}>
              <MediaView item={item} height={390} />
              <Text style={styles.shortTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.shortChannel}>@{item.channel}</Text>
            </TouchableOpacity>
          )} />
        </>
      )}

      {tab === 'upload' && (
        <>
          <Header text="Video Paylaş" />
          <ScrollView contentContainerStyle={styles.upload}>
            <Text style={styles.label}>Video veya fotoğraf başlığı</Text>
            <TextInput style={styles.input} placeholder="Başlık yaz..." value={title} onChangeText={setTitle} maxLength={120} />
            <Text style={styles.label}>Kanal adı</Text>
            <TextInput style={styles.input} value={channel} onChangeText={setChannel} placeholder="Kanal adı" maxLength={40} />
            <TouchableOpacity style={styles.button} onPress={pickMedia}><Text style={styles.buttonText}>📸 Fotoğraf / 🎥 Video Seç</Text></TouchableOpacity>
            {media && (
              <View style={{ marginVertical: 15 }}>
                <MediaView item={media} height={220} />
                <TouchableOpacity onPress={() => setMedia(null)}><Text style={styles.remove}>Seçimi kaldır</Text></TouchableOpacity>
              </View>
            )}
            <TouchableOpacity style={[styles.button, publishing && styles.buttonDisabled]} onPress={publish} disabled={publishing}>
              <Text style={styles.buttonText}>{publishing ? 'Yükleniyor...' : "⬆️ VB Tube'da Paylaş"}</Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      )}

      {tab === 'channel' && (
        <>
          <Header text="Kanalım" />
          <View style={styles.profile}>
            <View style={styles.avatar}><Text style={styles.avatarText}>VB</Text></View>
            <Text style={styles.profileName}>VB Creator</Text>
            <Text style={styles.channel}>{videos.filter(v => v.channel === 'VB Creator').length} video</Text>
            <Text style={styles.label}>Paylaştığım videolar</Text>
          </View>
          <FlatList data={videos.filter(v => v.channel === 'VB Creator')} keyExtractor={item => item.id} renderItem={({ item }) => <VideoCard item={item} />} />
        </>
      )}

      {selected && (
        <View style={styles.detail}>
          <TouchableOpacity onPress={() => setSelectedId(null)}><Text style={styles.back}>← Geri</Text></TouchableOpacity>
          <ScrollView>
            <MediaView item={selected} height={250} />
            <Text style={styles.videoTitle}>{selected.title}</Text>
            <Text style={styles.channel}>▶ {selected.channel}</Text>
            <TouchableOpacity style={styles.likeBtn} onPress={() => likeVideo(selected.id)}>
              <Text style={styles.likeText}>❤️ {selected.likes || 0} beğeni · Beğen</Text>
            </TouchableOpacity>
            <Text style={styles.label}>Yorumlar ({(selected.comments || []).length})</Text>
            {(selected.comments || []).map(c => <Text key={c.id} style={styles.comment}>💬 {c.text}</Text>)}
            <TextInput style={styles.input} placeholder="Yorum yaz..." value={comment} onChangeText={setComment} maxLength={300} />
            <TouchableOpacity style={styles.button} onPress={addComment}><Text style={styles.buttonText}>Yorum gönder</Text></TouchableOpacity>
          </ScrollView>
        </View>
      )}

      <View style={styles.nav}>
        {[['home', '🏠', 'Ana Sayfa'], ['shorts', '🎞️', 'Shorts'], ['upload', '➕', 'Paylaş'], ['channel', '👤', 'Kanalım']].map(([key, icon, label]) => (
          <TouchableOpacity key={key} style={styles.navItem} onPress={() => { setSelectedId(null); setTab(key); }}>
            <Text style={{ fontSize: 20 }}>{icon}</Text>
            <Text style={[styles.navText, tab === key && styles.activeNav]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: PURPLE, padding: 17, paddingTop: 45, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { fontSize: 25, color: '#fff', fontWeight: '900' },
  headerTitle: { color: '#fff', fontWeight: 'bold' },
  search: { margin: 12, padding: 12, backgroundColor: '#f1edff', borderRadius: 12, fontSize: 15 },
  card: { marginHorizontal: 12, marginBottom: 18, borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff', elevation: 3, borderWidth: 1, borderColor: '#eee' },
  cardBody: { padding: 12 },
  videoTitle: { fontSize: 17, fontWeight: 'bold', color: '#222', marginTop: 8 },
  channel: { color: '#777', marginTop: 5 },
  actions: { flexDirection: 'row', gap: 25, marginTop: 10 },
  actionText: { color: DARK, fontWeight: '600', marginTop: 8 },
  shortCard: { margin: 10, backgroundColor: '#181020', borderRadius: 14, overflow: 'hidden' },
  shortTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', padding: 12 },
  shortChannel: { color: '#ddd', paddingHorizontal: 12, paddingBottom: 12 },
  upload: { padding: 18 },
  label: { fontSize: 15, fontWeight: 'bold', marginVertical: 12, color: DARK },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 12, backgroundColor: '#fafafa' },
  button: { backgroundColor: PURPLE, padding: 14, borderRadius: 10, alignItems: 'center', marginVertical: 7 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  remove: { color: '#e53935', textAlign: 'center', padding: 10 },
  profile: { alignItems: 'center', padding: 22 },
  avatar: { width: 85, height: 85, borderRadius: 50, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 30, fontWeight: '900' },
  profileName: { fontSize: 22, fontWeight: 'bold', marginTop: 10 },
  nav: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#eee', justifyContent: 'space-around', paddingVertical: 8, backgroundColor: '#fff' },
  navItem: { alignItems: 'center', flex: 1 },
  navText: { fontSize: 11, color: '#777', marginTop: 3 },
  activeNav: { color: PURPLE, fontWeight: 'bold' },
  detail: { position: 'absolute', top: 0, bottom: 55, left: 0, right: 0, backgroundColor: '#fff', padding: 12, zIndex: 10 },
  back: { color: PURPLE, fontSize: 18, fontWeight: 'bold', padding: 8 },
  likeBtn: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: '#f3efff', alignItems: 'center' },
  likeText: { color: DARK, fontWeight: '700' },
  comment: { padding: 8, backgroundColor: '#f5f1ff', marginVertical: 3, borderRadius: 8 }
});
