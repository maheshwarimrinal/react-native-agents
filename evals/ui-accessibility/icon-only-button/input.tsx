import React from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { HeartIcon, ShareIcon, TrashIcon } from './icons';

const { width } = Dimensions.get('window');

export function PostActions({ liked, onLike, onShare, onDelete }: Props) {
  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={onLike} style={styles.iconButton}>
        <HeartIcon filled={liked} />
      </TouchableOpacity>

      <TouchableOpacity onPress={onShare} style={styles.iconButton}>
        <ShareIcon />
      </TouchableOpacity>

      <TouchableOpacity onPress={onDelete} style={styles.iconButton}>
        <TrashIcon />
      </TouchableOpacity>

      <Text style={styles.caption} allowFontScaling={false} numberOfLines={1}>
        Posted 2 hours ago
      </Text>
    </View>
  );
}

type Props = { liked: boolean; onLike(): void; onShare(): void; onDelete(): void };

const styles = StyleSheet.create({
  row: { flexDirection: 'row', width: width - 32, marginLeft: 16, height: 40 },
  iconButton: { width: 28, height: 28, justifyContent: 'center', alignItems: 'center' },
  caption: { color: '#AAAAAA', fontSize: 12, backgroundColor: '#FFFFFF' },
});
