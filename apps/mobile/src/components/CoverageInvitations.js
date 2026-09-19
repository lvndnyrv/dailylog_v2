import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Completes the invitation destination used by admin coverage notifications.
export default function CoverageInvitations({ rows, error, onRespond, onRetry }) {
  const [saving, setSaving] = useState(null);
  async function respond(row, response) {
    if (saving) return;
    setSaving(row.id);
    try { await onRespond(row.id, response); }
    catch (failure) { Alert.alert('Could not update coverage', failure.message || 'Please refresh and try again.'); }
    finally { setSaving(null); }
  }
  if (error) return <View style={styles.card}><Text style={styles.title}>Your coverage could not load</Text><TouchableOpacity accessibilityRole="button" onPress={onRetry}><Text style={styles.link}>Try again</Text></TouchableOpacity></View>;
  if (!rows.length) return null;
  return <View style={styles.card}>
    <Text style={styles.title}>Your room coverage</Text>
    <Text style={styles.hint}>Accept each invitation you can cover. Declining tells the front office to arrange a replacement.</Text>
    {rows.map(row => {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: row.timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(row.starts_at));
      const time = value => new Intl.DateTimeFormat('en-CA', { timeZone: row.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(value));
      return <View key={row.id} style={styles.row}>
        <Text style={styles.name}>{row.room_name}</Text>
        <Text style={styles.hint}>{date} · {time(row.starts_at)}–{time(row.ends_at)}</Text>
        <Text style={styles.hint}>{row.timezone} · {row.status === 'assigned' ? 'Awaiting your response' : row.status}</Text>
        {!!row.notes && <Text style={styles.hint}>{row.notes}</Text>}
        {!!row.review_issue && <View style={styles.reviewAlert} accessibilityRole="alert">
          <Text style={styles.reviewTitle}>Administrator review needed</Text>
          <Text style={styles.reviewText}>{row.review_issue}</Text>
          <Text style={styles.reviewHint}>Your commitment is still recorded. The front office has been alerted and will confirm or replace this plan.</Text>
        </View>}
        {row.status === 'assigned' && !row.review_issue && <View style={styles.actions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Decline coverage in ${row.room_name} on ${date}`} disabled={!!saving} style={styles.secondary} onPress={() => Alert.alert('Decline this coverage?', 'The front office will be notified that a replacement is needed.', [{text:'Keep invitation',style:'cancel'},{text:'Decline',onPress:()=>respond(row,'declined')}])}><Text style={styles.link}>Decline</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Accept coverage in ${row.room_name} on ${date}`} disabled={!!saving} style={styles.primary} onPress={() => respond(row,'accepted')}>{saving === row.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Accept coverage</Text>}</TouchableOpacity>
        </View>}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor:'#fff', borderWidth:1.5, borderColor:'#D6E1F0', borderRadius:20, padding:18, gap:10, marginBottom:16 },
  title: { fontFamily:'Lato_700Bold', fontSize:19, color:'#17335B' },
  name: { fontFamily:'Lato_700Bold', fontSize:16, color:'#17335B' },
  hint: { fontFamily:'Lato_400Regular', fontSize:14, lineHeight:21, color:'#5B6B82' },
  row: { borderTopWidth:1, borderTopColor:'#EDF3FB', paddingTop:12, gap:6 },
  reviewAlert: { backgroundColor:'#FFF4E1', borderWidth:1, borderColor:'#F2D39A', borderRadius:14, padding:12, gap:4, marginTop:6 },
  reviewTitle: { fontFamily:'Lato_700Bold', fontSize:14, color:'#9A6412' },
  reviewText: { fontFamily:'Lato_700Bold', fontSize:14, lineHeight:20, color:'#17335B' },
  reviewHint: { fontFamily:'Lato_400Regular', fontSize:13, lineHeight:19, color:'#5B6B82' },
  actions: { flexDirection:'row', flexWrap:'wrap', gap:10, marginTop:6 },
  primary: { flexGrow:1, backgroundColor:'#2F7CD8', borderRadius:24, padding:13, alignItems:'center', minHeight:46 },
  secondary: { flexGrow:1, borderWidth:1.5, borderColor:'#D6E1F0', borderRadius:24, padding:13, alignItems:'center', minHeight:46 },
  link: { fontFamily:'Lato_700Bold', fontSize:14, color:'#2F7CD8' },
  primaryText: { fontFamily:'Lato_700Bold', fontSize:14, color:'#fff' },
});
